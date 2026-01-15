# File Storage Pattern

> Cloud storage integration with signed URLs, visibility control, and multi-tenant path conventions.

## Overview

This pattern covers:
- Cloud storage integration (Supabase Storage / S3-compatible)
- Signed URL generation with expiration
- Public vs private asset visibility
- Multi-tenant path conventions
- Upload verification and error handling

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Backend   │────▶│   Storage   │
│             │     │   (API)     │     │  (Supabase) │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │                    │ 1. Generate path   │
      │                    │ 2. Upload file     │
      │                    │───────────────────▶│
      │                    │                    │
      │                    │ 3. Get signed URL  │
      │                    │◀───────────────────│
      │                    │                    │
      │ 4. Return URL      │                    │
      │◀───────────────────│                    │
```

## Implementation

### Configuration

```python
import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class StorageConfig:
    """Storage service configuration."""
    supabase_url: str
    supabase_key: str
    bucket_name: str
    public_bucket_name: str
    signed_url_expiration: int  # seconds
    max_file_size: int  # bytes
    allowed_mime_types: list[str]
    
    @classmethod
    def from_env(cls) -> "StorageConfig":
        return cls(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_key=os.environ["SUPABASE_SERVICE_KEY"],
            bucket_name=os.environ.get("STORAGE_BUCKET", "assets"),
            public_bucket_name=os.environ.get("PUBLIC_BUCKET", "public-assets"),
            signed_url_expiration=int(os.environ.get("SIGNED_URL_EXPIRATION", "3600")),
            max_file_size=int(os.environ.get("MAX_FILE_SIZE", "10485760")),  # 10MB
            allowed_mime_types=[
                "image/png",
                "image/jpeg",
                "image/webp",
                "image/gif",
            ],
        )
```

### Storage Service

```python
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4
import logging
import hashlib

from supabase import create_client, Client

logger = logging.getLogger(__name__)


@dataclass
class UploadResult:
    """Result of a file upload operation."""
    path: str
    url: str
    file_size: int
    content_type: str
    checksum: str


@dataclass
class SignedUrlResult:
    """Result of signed URL generation."""
    url: str
    expires_at: datetime


class StorageService:
    """
    Service for cloud storage operations.
    
    Features:
    - Multi-tenant path isolation
    - Signed URL generation
    - Visibility control (public/private)
    - Upload verification
    """
    
    def __init__(self, config: StorageConfig):
        self.config = config
        self.client: Client = create_client(
            config.supabase_url,
            config.supabase_key,
        )
    
    def _generate_path(
        self,
        user_id: str,
        job_id: str,
        content_type: str,
        suffix: str = "",
    ) -> str:
        """
        Generate storage path with multi-tenant isolation.
        
        Path format: {user_id}/{job_id}/{uuid}{suffix}.{ext}
        
        This ensures:
        - User isolation (each user has their own folder)
        - Job grouping (assets from same job are together)
        - Unique filenames (UUID prevents collisions)
        """
        # Determine file extension from content type
        ext_map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
        }
        ext = ext_map.get(content_type, "bin")
        
        # Generate unique filename
        filename = f"{uuid4()}{suffix}.{ext}"
        
        return f"{user_id}/{job_id}/{filename}"
    
    async def upload_asset(
        self,
        user_id: str,
        job_id: str,
        image_data: bytes,
        content_type: str,
        suffix: str = "",
        is_public: bool = False,
    ) -> UploadResult:
        """
        Upload an asset to storage.
        
        Args:
            user_id: Owner's user ID
            job_id: Associated job ID
            image_data: Raw file bytes
            content_type: MIME type
            suffix: Optional filename suffix (e.g., "_112x112")
            is_public: Whether to use public bucket
            
        Returns:
            UploadResult with path, URL, and metadata
            
        Raises:
            StorageError: If upload fails
            ValidationError: If file exceeds limits or invalid type
        """
        # Validate content type
        if content_type not in self.config.allowed_mime_types:
            raise ValidationError(f"Invalid content type: {content_type}")
        
        # Validate file size
        if len(image_data) > self.config.max_file_size:
            raise ValidationError(
                f"File too large: {len(image_data)} bytes "
                f"(max: {self.config.max_file_size})"
            )
        
        # Generate path
        path = self._generate_path(user_id, job_id, content_type, suffix)
        
        # Calculate checksum for verification
        checksum = hashlib.sha256(image_data).hexdigest()
        
        # Select bucket based on visibility
        bucket = (
            self.config.public_bucket_name 
            if is_public 
            else self.config.bucket_name
        )
        
        try:
            # Upload to storage
            result = self.client.storage.from_(bucket).upload(
                path=path,
                file=image_data,
                file_options={
                    "content-type": content_type,
                    "cache-control": "public, max-age=31536000",  # 1 year
                    "x-upsert": "false",  # Don't overwrite
                },
            )
            
            logger.info(
                f"Uploaded asset: path={path}, size={len(image_data)}, "
                f"bucket={bucket}"
            )
            
            # Get URL
            if is_public:
                url = self._get_public_url(bucket, path)
            else:
                url = await self.get_signed_url(path)
            
            return UploadResult(
                path=path,
                url=url,
                file_size=len(image_data),
                content_type=content_type,
                checksum=checksum,
            )
            
        except Exception as e:
            logger.error(f"Upload failed: {e}")
            raise StorageError(f"Failed to upload asset: {e}")
    
    async def get_signed_url(
        self,
        path: str,
        expiration: Optional[int] = None,
    ) -> str:
        """
        Generate a signed URL for private asset access.
        
        Args:
            path: Storage path
            expiration: URL expiration in seconds (default from config)
            
        Returns:
            Signed URL string
        """
        exp = expiration or self.config.signed_url_expiration
        
        result = self.client.storage.from_(self.config.bucket_name).create_signed_url(
            path=path,
            expires_in=exp,
        )
        
        return result["signedURL"]
    
    async def get_signed_urls_batch(
        self,
        paths: list[str],
        expiration: Optional[int] = None,
    ) -> dict[str, str]:
        """
        Generate signed URLs for multiple assets.
        
        More efficient than calling get_signed_url in a loop.
        
        Args:
            paths: List of storage paths
            expiration: URL expiration in seconds
            
        Returns:
            Dict mapping path to signed URL
        """
        exp = expiration or self.config.signed_url_expiration
        
        result = self.client.storage.from_(self.config.bucket_name).create_signed_urls(
            paths=paths,
            expires_in=exp,
        )
        
        return {item["path"]: item["signedURL"] for item in result}
    
    def _get_public_url(self, bucket: str, path: str) -> str:
        """Get public URL for an asset in public bucket."""
        return f"{self.config.supabase_url}/storage/v1/object/public/{bucket}/{path}"
    
    async def update_visibility(
        self,
        path: str,
        is_public: bool,
        user_id: str,
    ) -> str:
        """
        Update asset visibility by moving between buckets.
        
        Args:
            path: Current storage path
            is_public: New visibility setting
            user_id: Owner's user ID (for authorization)
            
        Returns:
            New URL for the asset
        """
        # Verify path belongs to user
        if not path.startswith(f"{user_id}/"):
            raise AuthorizationError("Cannot modify asset owned by another user")
        
        source_bucket = (
            self.config.bucket_name 
            if is_public 
            else self.config.public_bucket_name
        )
        dest_bucket = (
            self.config.public_bucket_name 
            if is_public 
            else self.config.bucket_name
        )
        
        # Move file between buckets
        # Note: Supabase doesn't have native move, so we copy + delete
        
        # Download from source
        data = self.client.storage.from_(source_bucket).download(path)
        
        # Upload to destination
        self.client.storage.from_(dest_bucket).upload(
            path=path,
            file=data,
            file_options={"x-upsert": "true"},
        )
        
        # Delete from source
        self.client.storage.from_(source_bucket).remove([path])
        
        # Return new URL
        if is_public:
            return self._get_public_url(dest_bucket, path)
        else:
            return await self.get_signed_url(path)
    
    async def delete_asset(self, path: str, user_id: str) -> None:
        """
        Delete an asset from storage.
        
        Args:
            path: Storage path
            user_id: Owner's user ID (for authorization)
        """
        # Verify path belongs to user
        if not path.startswith(f"{user_id}/"):
            raise AuthorizationError("Cannot delete asset owned by another user")
        
        # Try both buckets (we don't know which one it's in)
        try:
            self.client.storage.from_(self.config.bucket_name).remove([path])
        except:
            pass
        
        try:
            self.client.storage.from_(self.config.public_bucket_name).remove([path])
        except:
            pass
        
        logger.info(f"Deleted asset: path={path}")
    
    async def get_asset_metadata(self, path: str) -> dict:
        """Get metadata for an asset."""
        # Try private bucket first
        try:
            result = self.client.storage.from_(self.config.bucket_name).list(
                path=path.rsplit("/", 1)[0],
                options={"search": path.rsplit("/", 1)[1]},
            )
            if result:
                return result[0]
        except:
            pass
        
        # Try public bucket
        result = self.client.storage.from_(self.config.public_bucket_name).list(
            path=path.rsplit("/", 1)[0],
            options={"search": path.rsplit("/", 1)[1]},
        )
        
        if result:
            return result[0]
        
        raise NotFoundError(f"Asset not found: {path}")
```

### Upload Verification

```python
async def upload_with_verification(
    storage_service: StorageService,
    user_id: str,
    job_id: str,
    image_data: bytes,
    content_type: str,
) -> UploadResult:
    """
    Upload with post-upload verification.
    
    Verifies that the uploaded file matches the original
    by checking file size.
    """
    result = await storage_service.upload_asset(
        user_id=user_id,
        job_id=job_id,
        image_data=image_data,
        content_type=content_type,
    )
    
    # Verify upload
    if result.file_size != len(image_data):
        logger.error(
            f"Upload verification failed: expected={len(image_data)}, "
            f"got={result.file_size}"
        )
        # Clean up failed upload
        await storage_service.delete_asset(result.path, user_id)
        raise StorageError("Upload verification failed - size mismatch")
    
    return result
```

### Direct Upload with Presigned URLs

```python
@dataclass
class PresignedUpload:
    """Presigned upload URL and metadata."""
    upload_url: str
    path: str
    expires_at: datetime
    fields: dict  # Additional form fields for S3-style upload


class StorageService:
    # ... previous methods ...
    
    async def create_presigned_upload(
        self,
        user_id: str,
        job_id: str,
        content_type: str,
        file_size: int,
    ) -> PresignedUpload:
        """
        Create a presigned URL for direct client upload.
        
        This allows clients to upload directly to storage
        without proxying through the backend.
        
        Args:
            user_id: Owner's user ID
            job_id: Associated job ID
            content_type: Expected MIME type
            file_size: Expected file size in bytes
            
        Returns:
            PresignedUpload with URL and required fields
        """
        # Validate
        if content_type not in self.config.allowed_mime_types:
            raise ValidationError(f"Invalid content type: {content_type}")
        
        if file_size > self.config.max_file_size:
            raise ValidationError(f"File too large: {file_size}")
        
        # Generate path
        path = self._generate_path(user_id, job_id, content_type)
        
        # Create presigned URL (Supabase-specific)
        result = self.client.storage.from_(self.config.bucket_name).create_signed_upload_url(
            path=path,
        )
        
        return PresignedUpload(
            upload_url=result["signedURL"],
            path=path,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            fields={
                "content-type": content_type,
            },
        )
```

## API Routes

```python
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/storage")


class UploadResponse(BaseModel):
    path: str
    url: str
    file_size: int


class PresignedUploadResponse(BaseModel):
    upload_url: str
    path: str
    expires_at: datetime


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    job_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    storage_service: StorageService = Depends(get_storage_service),
):
    """Upload a file through the backend."""
    # Read file content
    content = await file.read()
    
    # Upload
    result = await storage_service.upload_asset(
        user_id=current_user.id,
        job_id=job_id,
        image_data=content,
        content_type=file.content_type,
    )
    
    return UploadResponse(
        path=result.path,
        url=result.url,
        file_size=result.file_size,
    )


@router.post("/presigned-upload", response_model=PresignedUploadResponse)
async def create_presigned_upload(
    content_type: str = Query(...),
    file_size: int = Query(...),
    job_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    storage_service: StorageService = Depends(get_storage_service),
):
    """Create a presigned URL for direct upload."""
    result = await storage_service.create_presigned_upload(
        user_id=current_user.id,
        job_id=job_id,
        content_type=content_type,
        file_size=file_size,
    )
    
    return PresignedUploadResponse(
        upload_url=result.upload_url,
        path=result.path,
        expires_at=result.expires_at,
    )


@router.put("/assets/{asset_id}/visibility")
async def update_visibility(
    asset_id: str,
    is_public: bool = Query(...),
    current_user: User = Depends(get_current_user),
    storage_service: StorageService = Depends(get_storage_service),
    asset_service: AssetService = Depends(get_asset_service),
):
    """Update asset visibility (public/private)."""
    # Get asset
    asset = await asset_service.get(asset_id)
    if asset.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update storage
    new_url = await storage_service.update_visibility(
        path=asset.storage_path,
        is_public=is_public,
        user_id=current_user.id,
    )
    
    # Update database
    await asset_service.update(asset_id, url=new_url, is_public=is_public)
    
    return {"url": new_url, "is_public": is_public}
```

## Path Conventions

```
{bucket}/
├── {user_id}/
│   ├── {job_id}/
│   │   ├── {uuid}.png           # Generated asset
│   │   ├── {uuid}_112x112.png   # Resized variant
│   │   └── {uuid}_56x56.png     # Another variant
│   ├── logos/
│   │   ├── primary.png          # User's primary logo
│   │   └── secondary.png        # Secondary logo
│   └── profile/
│       └── avatar.png           # Profile picture
```

## Best Practices

1. **Multi-tenant isolation** - Always prefix paths with user_id
2. **Unique filenames** - Use UUIDs to prevent collisions
3. **Signed URLs for private** - Never expose private bucket URLs directly
4. **Cache headers** - Set appropriate cache-control for CDN efficiency
5. **Verify uploads** - Check file size after upload
6. **Clean up failures** - Delete partial uploads on error
7. **Batch operations** - Use batch signed URL generation for lists
