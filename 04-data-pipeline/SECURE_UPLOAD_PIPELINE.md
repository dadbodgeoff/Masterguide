# Secure Upload Pipeline

Production-grade file upload handling with validation, malware scanning, and duplicate detection.

## Problem

File uploads are attack vectors:
- Malware disguised as PDFs
- Duplicate processing wastes resources
- Race conditions cause double-processing
- Large files exhaust memory
- Invalid files waste downstream API costs

## Solution: Multi-Stage Validation Pipeline

```
Upload Request
    ↓
[1] Size + Type Check (instant)
    ↓
[2] Content Signature Validation (ms)
    ↓
[3] Malware Scan - ClamAV (50-200ms)
    ↓
[4] Hash-Based Duplicate Check (ms)
    ↓
[5] Race Condition Lock (Redis)
    ↓
[6] Upload to Storage
    ↓
[7] Clear Lock + Return URL
```

**Key principle**: Fail fast, check cheap things first.

---

## Stage 1-2: File Validator

```python
class FileValidator:
    def __init__(self):
        self.max_size = 10 * 1024 * 1024  # 10MB
        self.allowed_types = [
            'application/pdf',
            'image/jpeg',
            'image/png',
        ]
        self.malware_scanner = MalwareScannerService()
    
    async def validate_file(self, file: UploadFile) -> Dict:
        """
        Multi-stage file validation
        Returns: {"valid": bool, "error": str|None, "validation_details": dict}
        """
        validation_details = {
            "filename": file.filename,
            "content_type": file.content_type,
            "checks_passed": []
        }
        
        # Check 1: File size (before reading content)
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset
        
        validation_details["file_size_bytes"] = file_size
        
        if file_size > self.max_size:
            return {
                "valid": False,
                "error": f"File too large ({file_size / 1024 / 1024:.1f}MB). Maximum is 10MB.",
                "validation_details": validation_details
            }
        
        if file_size == 0:
            return {
                "valid": False,
                "error": "File is empty.",
                "validation_details": validation_details
            }
        
        validation_details["checks_passed"].append("size_check")
        
        # Check 2: MIME type
        if file.content_type not in self.allowed_types:
            return {
                "valid": False,
                "error": f"Invalid file type ({file.content_type}). Allowed: PDF, JPG, PNG.",
                "validation_details": validation_details
            }
        
        validation_details["checks_passed"].append("type_check")
        
        # Check 3: Content signature (PDF magic bytes)
        if file.content_type == 'application/pdf':
            header = await file.read(4)
            file.file.seek(0)
            
            if header != b'%PDF':
                return {
                    "valid": False,
                    "error": "File appears corrupted. Please re-scan and try again.",
                    "validation_details": validation_details
                }
            
            validation_details["checks_passed"].append("pdf_signature_check")
        
        # Check 4: Malware scan
        scan_result = await self.malware_scanner.scan_file(file)
        validation_details["malware_scan"] = scan_result
        
        if not scan_result['safe']:
            threat = scan_result.get('threat_found', 'Unknown threat')
            return {
                "valid": False,
                "error": f"Security threat detected: {threat}. File rejected.",
                "validation_details": validation_details
            }
        
        validation_details["checks_passed"].append("malware_scan")
        
        return {
            "valid": True,
            "error": None,
            "validation_details": validation_details
        }
```

---

## Stage 3: Malware Scanner (ClamAV)

```python
import clamd
from io import BytesIO

class MalwareScannerService:
    def __init__(self):
        self.enabled = os.getenv('CLAMAV_ENABLED', 'true').lower() == 'true'
        self.host = os.getenv('CLAMAV_HOST', 'localhost')
        self.port = int(os.getenv('CLAMAV_PORT', '3310'))
        self.client = None
        
        if self.enabled:
            try:
                self.client = clamd.ClamdNetworkSocket(host=self.host, port=self.port)
                self.client.ping()  # Test connection
            except Exception as e:
                logger.warning(f"ClamAV not available: {e}. Scanning disabled.")
                self.enabled = False
    
    async def scan_file(self, file: UploadFile) -> Dict:
        """
        Scan file for malware
        Returns: {"safe": bool, "threat_found": str|None, "scan_performed": bool}
        """
        import time
        scan_start = time.time()
        
        # Graceful degradation if ClamAV unavailable
        if not self.enabled or not self.client:
            return {
                "safe": True,
                "threat_found": None,
                "scan_performed": False,
                "scan_time_ms": 0
            }
        
        try:
            file_content = await file.read()
            file.file.seek(0)  # Reset for subsequent reads
            
            # ClamAV instream scan
            result = self.client.instream(BytesIO(file_content))
            scan_time = (time.time() - scan_start) * 1000
            
            # Result format: {'stream': ('OK', None)} or {'stream': ('FOUND', 'Eicar-Test-Signature')}
            status, threat = result.get('stream', ('ERROR', 'Unknown'))
            
            if status == 'OK':
                return {
                    "safe": True,
                    "threat_found": None,
                    "scan_performed": True,
                    "scan_time_ms": scan_time
                }
            elif status == 'FOUND':
                logger.warning(f"MALWARE DETECTED: {file.filename} - {threat}")
                return {
                    "safe": False,
                    "threat_found": threat,
                    "scan_performed": True,
                    "scan_time_ms": scan_time
                }
            else:
                # Fail-safe: reject on scan error
                return {
                    "safe": False,
                    "threat_found": f"Scan error: {status}",
                    "scan_performed": True,
                    "scan_time_ms": scan_time
                }
                
        except Exception as e:
            logger.error(f"Malware scan failed: {e}")
            # Fail-safe: reject if scan fails
            return {
                "safe": False,
                "threat_found": f"Scan failed: {str(e)}",
                "scan_performed": False,
                "scan_time_ms": 0
            }
    
    def get_status(self) -> Dict:
        """Health check for ClamAV"""
        if not self.enabled:
            return {"enabled": False, "status": "disabled"}
        
        try:
            self.client.ping()
            return {
                "enabled": True,
                "status": "healthy",
                "version": self.client.version()
            }
        except Exception as e:
            return {"enabled": True, "status": "unhealthy", "error": str(e)}
```

### Docker Setup for ClamAV

```dockerfile
# clamav/Dockerfile
FROM clamav/clamav:latest

COPY clamd.conf /etc/clamav/clamd.conf
COPY freshclam.conf /etc/clamav/freshclam.conf

EXPOSE 3310
```

```yaml
# docker-compose.yml
services:
  clamav:
    build: ./clamav
    ports:
      - "3310:3310"
    volumes:
      - clamav-db:/var/lib/clamav
    healthcheck:
      test: ["CMD", "clamdscan", "--ping", "3"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## Stage 4-5: Duplicate Detection with Race Protection

```python
import hashlib
import asyncio
from contextlib import asynccontextmanager

class InvoiceDuplicateDetector:
    def __init__(self):
        self.client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        try:
            from services.redis_client import cache
            self.redis = cache
            self.redis_enabled = cache.enabled
        except:
            self.redis = None
            self.redis_enabled = False
    
    def calculate_file_hash(self, file_content: bytes) -> str:
        """SHA256 hash for duplicate detection"""
        return hashlib.sha256(file_content).hexdigest()
    
    @asynccontextmanager
    async def redis_lock(self, lock_key: str, timeout: int = 10):
        """
        Distributed lock to prevent race conditions
        Uses Redis SET NX with ownership verification
        """
        acquired = False
        lock_value = f"{os.getpid()}:{asyncio.current_task().get_name()}"
        
        try:
            if self.redis_enabled:
                # Try to acquire lock with retries
                for _ in range(timeout * 10):
                    if self.redis.client.set(lock_key, lock_value, nx=True, ex=timeout):
                        acquired = True
                        break
                    await asyncio.sleep(0.1)
                
                if not acquired:
                    raise TimeoutError(f"Could not acquire lock: {lock_key}")
            
            yield acquired
            
        finally:
            # Release only if we own the lock
            if acquired and self.redis_enabled:
                try:
                    current = self.redis.client.get(lock_key)
                    if current == lock_value:
                        self.redis.client.delete(lock_key)
                except Exception as e:
                    logger.error(f"Error releasing lock: {e}")
    
    async def check_for_duplicate_by_hash(
        self,
        user_id: str,
        account_id: str,
        file_hash: str
    ) -> Optional[Dict]:
        """Fast duplicate check by file hash"""
        try:
            result = self.client.table("invoices").select(
                "id, invoice_number, vendor_name, invoice_date, total, created_at"
            ).eq("account_id", account_id).eq("file_hash", file_hash).execute()
            
            if result.data:
                dup = result.data[0]
                return {
                    "type": "file_hash",
                    "invoice_id": dup["id"],
                    "message": "Exact duplicate file detected"
                }
            return None
        except Exception as e:
            logger.error(f"Hash duplicate check failed: {e}")
            return None
    
    async def mark_processing(self, user_id: str, account_id: str, file_hash: str, ttl: int = 300):
        """Mark file as being processed (prevents concurrent processing)"""
        if self.redis_enabled:
            key = f"processing:{account_id}:{file_hash}"
            self.redis.client.setex(key, ttl, "1")
    
    async def is_processing(self, user_id: str, account_id: str, file_hash: str) -> bool:
        """Check if file is currently being processed"""
        if self.redis_enabled:
            key = f"processing:{account_id}:{file_hash}"
            return self.redis.client.exists(key) > 0
        return False
    
    async def clear_processing(self, user_id: str, account_id: str, file_hash: str):
        """Clear processing marker"""
        if self.redis_enabled:
            key = f"processing:{account_id}:{file_hash}"
            self.redis.client.delete(key)
```

---

## Complete Upload Endpoint

```python
@router.post("/upload")
@rate_limit("invoice_parse")
async def upload_invoice(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    auth: AuthenticatedUser = Depends(get_current_membership),
):
    """
    Upload file with full validation pipeline
    IMPORTANT: Check limits BEFORE upload to prevent wasted processing
    """
    current_user = auth.id
    
    # Check usage limits FIRST
    allowed, limit_details = usage_service.check_limit(current_user, 'invoice_upload')
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                'error': 'Usage limit exceeded',
                'message': limit_details['message'],
                'current_usage': limit_details['current_usage'],
                'limit': limit_details['limit_value'],
                'reset_date': limit_details['reset_date']
            }
        )
    
    # Start monitoring session
    session_id = monitoring_service.start_session(current_user, file.filename)
    
    try:
        # Stage 1-3: Validate file (size, type, signature, malware)
        validation = await file_validator.validate_file(file)
        if not validation['valid']:
            monitoring_service.log_error(session_id, "upload", validation['error'])
            raise HTTPException(status_code=400, detail=validation['error'])
        
        # Stage 4: Calculate hash for duplicate detection
        file.file.seek(0)
        file_content = await file.read()
        file_hash = duplicate_detector.calculate_file_hash(file_content)
        file.file.seek(0)
        
        # Check for duplicate by hash (fast)
        hash_duplicate = await duplicate_detector.check_for_duplicate_by_hash(
            user_id=current_user,
            account_id=auth.account_id,
            file_hash=file_hash
        )
        if hash_duplicate:
            raise HTTPException(
                status_code=409,
                detail={"error": "duplicate", "message": hash_duplicate['message']}
            )
        
        # Stage 5: Race condition protection
        if await duplicate_detector.is_processing(current_user, auth.account_id, file_hash):
            raise HTTPException(
                status_code=409,
                detail={"error": "processing", "message": "File is currently being processed."}
            )
        
        # Mark as processing (with TTL failsafe)
        await duplicate_detector.mark_processing(current_user, auth.account_id, file_hash, ttl=300)
        
        try:
            # Stage 6: Upload to storage
            file_url = await storage_service.upload_file(file=file, user_id=current_user)
        except Exception as e:
            # Clear processing marker on failure
            await duplicate_detector.clear_processing(current_user, auth.account_id, file_hash)
            raise
        
        # Stage 7: Success - schedule background tasks
        background_tasks.add_task(run_post_upload_tasks, current_user, session_id)
        
        return JSONResponse({
            "success": True,
            "file_url": file_url,
            "filename": file.filename,
            "session_id": session_id,
            "file_hash": file_hash
        })
        
    except HTTPException:
        raise
    except Exception as e:
        monitoring_service.log_error(session_id, "upload", str(e))
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
```

---

## Guest Mode (Unauthenticated Uploads)

For landing page demos with IP-based rate limiting:

```python
@router.post("/guest-upload")
async def guest_upload_invoice(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    policies_acknowledged: bool = Form(...),
    terms_version: str = Form(...),
    privacy_version: str = Form(...),
):
    """Guest upload with IP-based rate limiting"""
    
    if not policies_acknowledged:
        raise HTTPException(status_code=400, detail="Policy acknowledgement required.")
    
    client_ip = request.client.host if request.client else "unknown"
    wait_seconds = reserve_guest_upload_slot(client_ip)
    
    if wait_seconds is not None:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "guest_upload_limit",
                "message": "Demo limit reached. Create a free account for more.",
                "retry_after_seconds": wait_seconds
            }
        )
    
    guest_session_id = str(uuid.uuid4())
    guest_user_id = f"guest_{guest_session_id}"
    
    # Same validation pipeline, different user context
    validation = await file_validator.validate_file(file)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail=validation["error"])
    
    # ... rest of upload logic with guest_user_id
```

---

## Gotchas & Lessons Learned

1. **Check limits BEFORE upload**: Don't waste bandwidth/processing on files that will be rejected
2. **TTL on processing markers**: If upload crashes, marker auto-expires (300s default)
3. **ClamAV graceful degradation**: Don't block uploads if scanner is down (log warning)
4. **Hash before upload**: Calculate hash from memory, not after storage write
5. **Fail-safe on scan errors**: Reject file if malware scan fails (not just if malware found)
6. **Guest IP tracking**: Use Redis with TTL for IP-based rate limiting
