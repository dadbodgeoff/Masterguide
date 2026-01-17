# Phase 13: File Storage

> **Time**: 15 minutes  
> **Prerequisites**: [04-DATABASE](./04-DATABASE.md), [05-AUTH](./05-AUTH.md)  
> **Produces**: Supabase Storage integration, upload service, signed URLs, file validation

---

## 🤖 Agent Execution Context

**What you're doing**: Setting up file storage using Supabase Storage — upload service, signed URLs, file validation, and storage policies. This enables secure file uploads with proper access control.

**Expected state BEFORE execution**:
- Phase 04 complete (Supabase configured)
- Phase 05 complete (auth exists)
- Supabase project running

**What you'll create**:
- `packages/backend/src/storage/__init__.py` — Storage module
- `packages/backend/src/storage/service.py` — Storage service
- `packages/backend/src/storage/validation.py` — File validation
- `apps/web/lib/storage/client.ts` — Frontend storage client
- `apps/web/lib/storage/hooks.ts` — React hooks for uploads
- `apps/web/components/ui/file-upload.tsx` — Upload component
- `supabase/migrations/00003_storage_buckets.sql` — Storage bucket setup
- `packages/backend/tests/storage/test_service.py` — Storage tests
- `packages/backend/tests/storage/test_validation.py` — Validation tests

**Execution approach**:
1. Create storage migration for buckets
2. Create backend storage service
3. Create file validation utilities
4. Create frontend storage client
5. Create upload hooks and component
6. Create tests

**IMPORTANT**:
- Always validate file types and sizes before upload
- Use signed URLs for private files
- Set appropriate bucket policies
- Scan files for malware in production

**After completion, tell the user**:
- "Phase 13 complete. File storage configured."
- "Supabase Storage buckets, upload service, and validation ready."
- "Run migration to create storage buckets."

---

## Skip Conditions

Skip this phase if ANY of these exist:
- `packages/backend/src/storage/` directory exists
- `apps/web/lib/storage/` directory exists

## Purpose

Set up secure file storage with:
- Supabase Storage integration
- File type and size validation
- Signed URLs for private access
- Upload progress tracking
- Image optimization hooks

---

## Artifacts to Create

### 1. supabase/migrations/00003_storage_buckets.sql

```sql
-- Storage bucket configuration
-- Run: supabase db push

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  (
    'avatars',
    'avatars',
    true,  -- Public bucket for profile pictures
    5242880,  -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'documents',
    'documents',
    false,  -- Private bucket
    52428800,  -- 50MB limit
    ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
  ),
  (
    'uploads',
    'uploads',
    false,  -- Private bucket for general uploads
    104857600,  -- 100MB limit
    NULL  -- Allow all types (validate in application)
  )
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for avatars (public read, authenticated write)
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Storage policies for documents (owner access only)
CREATE POLICY "Users can read their own documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Storage policies for uploads (owner access only)
CREATE POLICY "Users can read their own uploads"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload to their folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

### 2. packages/backend/src/storage/__init__.py

```python
"""
Storage module.

Provides file storage services using Supabase Storage.
"""

from .service import StorageService, StorageError
from .validation import (
    validate_file,
    validate_image,
    get_mime_type,
    FileValidationError,
)

__all__ = [
    "StorageService",
    "StorageError",
    "validate_file",
    "validate_image",
    "get_mime_type",
    "FileValidationError",
]
```

### 3. packages/backend/src/storage/service.py

```python
"""
Storage service for file uploads.

Provides a high-level interface for Supabase Storage operations.
"""

from datetime import timedelta
from typing import BinaryIO
from uuid import uuid4

import structlog
from supabase import Client

from .validation import validate_file, get_mime_type

logger = structlog.get_logger(__name__)


class StorageError(Exception):
    """Storage operation error."""
    
    def __init__(self, message: str, code: str = "STORAGE_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


class StorageService:
    """
    Service for managing file storage.
    
    Handles uploads, downloads, and URL generation for Supabase Storage.
    """
    
    # Bucket configurations
    BUCKETS = {
        "avatars": {
            "public": True,
            "max_size": 5 * 1024 * 1024,  # 5MB
            "allowed_types": {"image/jpeg", "image/png", "image/webp", "image/gif"},
        },
        "documents": {
            "public": False,
            "max_size": 50 * 1024 * 1024,  # 50MB
            "allowed_types": {
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "text/plain",
            },
        },
        "uploads": {
            "public": False,
            "max_size": 100 * 1024 * 1024,  # 100MB
            "allowed_types": None,  # All types allowed
        },
    }
    
    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.storage = supabase.storage
    
    async def upload(
        self,
        bucket: str,
        user_id: str,
        file: BinaryIO,
        filename: str,
        content_type: str | None = None,
    ) -> dict:
        """
        Upload a file to storage.
        
        Args:
            bucket: Target bucket name
            user_id: Owner's user ID
            file: File-like object to upload
            filename: Original filename
            content_type: MIME type (auto-detected if not provided)
            
        Returns:
            Upload result with path and URL
            
        Raises:
            StorageError: If upload fails
        """
        # Validate bucket
        if bucket not in self.BUCKETS:
            raise StorageError(f"Invalid bucket: {bucket}", "INVALID_BUCKET")
        
        bucket_config = self.BUCKETS[bucket]
        
        # Read file content
        content = file.read()
        file_size = len(content)
        
        # Detect content type if not provided
        if not content_type:
            content_type = get_mime_type(filename, content)
        
        # Validate file
        validate_file(
            content=content,
            filename=filename,
            content_type=content_type,
            max_size=bucket_config["max_size"],
            allowed_types=bucket_config["allowed_types"],
        )
        
        # Generate unique path: user_id/uuid_filename
        file_ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
        unique_name = f"{uuid4()}.{file_ext}" if file_ext else str(uuid4())
        path = f"{user_id}/{unique_name}"
        
        try:
            # Upload to Supabase Storage
            result = self.storage.from_(bucket).upload(
                path=path,
                file=content,
                file_options={"content-type": content_type},
            )
            
            logger.info(
                "file_uploaded",
                bucket=bucket,
                path=path,
                size=file_size,
                content_type=content_type,
            )
            
            # Get URL
            if bucket_config["public"]:
                url = self.storage.from_(bucket).get_public_url(path)
            else:
                url = None  # Use signed URL for private files
            
            return {
                "path": path,
                "bucket": bucket,
                "size": file_size,
                "content_type": content_type,
                "url": url,
                "filename": filename,
            }
            
        except Exception as e:
            logger.error("upload_failed", bucket=bucket, error=str(e))
            raise StorageError(f"Upload failed: {str(e)}", "UPLOAD_FAILED")
    
    async def get_signed_url(
        self,
        bucket: str,
        path: str,
        expires_in: int = 3600,
    ) -> str:
        """
        Generate a signed URL for private file access.
        
        Args:
            bucket: Bucket name
            path: File path within bucket
            expires_in: URL expiration in seconds (default: 1 hour)
            
        Returns:
            Signed URL string
        """
        try:
            result = self.storage.from_(bucket).create_signed_url(
                path=path,
                expires_in=expires_in,
            )
            return result["signedURL"]
        except Exception as e:
            logger.error("signed_url_failed", bucket=bucket, path=path, error=str(e))
            raise StorageError(f"Failed to generate signed URL: {str(e)}")
    
    async def delete(self, bucket: str, path: str) -> bool:
        """
        Delete a file from storage.
        
        Args:
            bucket: Bucket name
            path: File path within bucket
            
        Returns:
            True if deleted successfully
        """
        try:
            self.storage.from_(bucket).remove([path])
            logger.info("file_deleted", bucket=bucket, path=path)
            return True
        except Exception as e:
            logger.error("delete_failed", bucket=bucket, path=path, error=str(e))
            raise StorageError(f"Delete failed: {str(e)}", "DELETE_FAILED")
    
    async def list_files(
        self,
        bucket: str,
        user_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """
        List files in a user's folder.
        
        Args:
            bucket: Bucket name
            user_id: User ID (folder name)
            limit: Maximum files to return
            offset: Pagination offset
            
        Returns:
            List of file metadata
        """
        try:
            result = self.storage.from_(bucket).list(
                path=user_id,
                options={"limit": limit, "offset": offset},
            )
            return result
        except Exception as e:
            logger.error("list_failed", bucket=bucket, user_id=user_id, error=str(e))
            raise StorageError(f"List failed: {str(e)}", "LIST_FAILED")
    
    async def get_public_url(self, bucket: str, path: str) -> str:
        """
        Get public URL for a file in a public bucket.
        
        Args:
            bucket: Bucket name
            path: File path
            
        Returns:
            Public URL string
        """
        if bucket not in self.BUCKETS or not self.BUCKETS[bucket]["public"]:
            raise StorageError(f"Bucket {bucket} is not public", "NOT_PUBLIC")
        
        return self.storage.from_(bucket).get_public_url(path)
```

### 4. packages/backend/src/storage/validation.py

```python
"""
File validation utilities.

Provides validation for file uploads including type, size, and content checks.
"""

import mimetypes
from typing import Set


class FileValidationError(Exception):
    """File validation error."""
    
    def __init__(self, message: str, code: str = "VALIDATION_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


# Magic bytes for common file types
MAGIC_BYTES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",  # WebP starts with RIFF
    b"%PDF": "application/pdf",
    b"PK\x03\x04": "application/zip",  # Also docx, xlsx, etc.
}

# Dangerous file extensions
DANGEROUS_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".msi", ".scr",
    ".ps1", ".vbs", ".js", ".jse", ".wsf", ".wsh",
    ".php", ".phtml", ".asp", ".aspx", ".jsp",
}


def get_mime_type(filename: str, content: bytes | None = None) -> str:
    """
    Detect MIME type from filename and optionally content.
    
    Args:
        filename: Original filename
        content: File content for magic byte detection
        
    Returns:
        Detected MIME type
    """
    # Try magic bytes first if content provided
    if content:
        for magic, mime_type in MAGIC_BYTES.items():
            if content.startswith(magic):
                return mime_type
    
    # Fall back to extension-based detection
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def validate_file(
    content: bytes,
    filename: str,
    content_type: str,
    max_size: int,
    allowed_types: Set[str] | None = None,
) -> None:
    """
    Validate a file for upload.
    
    Args:
        content: File content
        filename: Original filename
        content_type: Declared MIME type
        max_size: Maximum allowed size in bytes
        allowed_types: Set of allowed MIME types (None = all allowed)
        
    Raises:
        FileValidationError: If validation fails
    """
    # Check size
    if len(content) > max_size:
        raise FileValidationError(
            f"File too large. Maximum size is {max_size // (1024*1024)}MB",
            "FILE_TOO_LARGE",
        )
    
    # Check for empty file
    if len(content) == 0:
        raise FileValidationError("File is empty", "EMPTY_FILE")
    
    # Check extension
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in DANGEROUS_EXTENSIONS:
        raise FileValidationError(
            f"File type not allowed: {ext}",
            "DANGEROUS_FILE_TYPE",
        )
    
    # Check MIME type
    if allowed_types and content_type not in allowed_types:
        raise FileValidationError(
            f"File type not allowed: {content_type}",
            "INVALID_FILE_TYPE",
        )
    
    # Verify content matches declared type
    detected_type = get_mime_type(filename, content)
    if allowed_types and detected_type not in allowed_types:
        raise FileValidationError(
            f"File content does not match declared type",
            "TYPE_MISMATCH",
        )


def validate_image(
    content: bytes,
    filename: str,
    max_size: int = 10 * 1024 * 1024,
    min_dimensions: tuple[int, int] | None = None,
    max_dimensions: tuple[int, int] | None = None,
) -> dict:
    """
    Validate an image file.
    
    Args:
        content: Image content
        filename: Original filename
        max_size: Maximum size in bytes
        min_dimensions: Minimum (width, height)
        max_dimensions: Maximum (width, height)
        
    Returns:
        Image metadata (width, height, format)
        
    Raises:
        FileValidationError: If validation fails
    """
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    content_type = get_mime_type(filename, content)
    
    validate_file(
        content=content,
        filename=filename,
        content_type=content_type,
        max_size=max_size,
        allowed_types=allowed_types,
    )
    
    # Try to get image dimensions
    try:
        # Use PIL if available
        from PIL import Image
        import io
        
        img = Image.open(io.BytesIO(content))
        width, height = img.size
        format = img.format
        
        if min_dimensions:
            min_w, min_h = min_dimensions
            if width < min_w or height < min_h:
                raise FileValidationError(
                    f"Image too small. Minimum size is {min_w}x{min_h}",
                    "IMAGE_TOO_SMALL",
                )
        
        if max_dimensions:
            max_w, max_h = max_dimensions
            if width > max_w or height > max_h:
                raise FileValidationError(
                    f"Image too large. Maximum size is {max_w}x{max_h}",
                    "IMAGE_TOO_LARGE",
                )
        
        return {
            "width": width,
            "height": height,
            "format": format,
            "content_type": content_type,
        }
        
    except ImportError:
        # PIL not available, skip dimension checks
        return {
            "content_type": content_type,
        }
    except Exception as e:
        raise FileValidationError(f"Invalid image: {str(e)}", "INVALID_IMAGE")
```


### 5. apps/web/lib/storage/client.ts

```typescript
/**
 * Storage client for Supabase Storage.
 */

import { createClient } from '@/lib/supabase/client';

export type BucketName = 'avatars' | 'documents' | 'uploads';

export interface UploadResult {
  path: string;
  bucket: BucketName;
  url: string | null;
  size: number;
  contentType: string;
}

export interface UploadOptions {
  onProgress?: (progress: number) => void;
  contentType?: string;
}

export class StorageClient {
  private supabase = createClient();

  /**
   * Upload a file to storage.
   */
  async upload(
    bucket: BucketName,
    file: File,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const userId = (await this.supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || '';
    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const path = `${userId}/${uniqueName}`;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: options.contentType || file.type,
        upsert: false,
      });

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    // Get URL for public buckets
    let url: string | null = null;
    if (bucket === 'avatars') {
      const { data: urlData } = this.supabase.storage
        .from(bucket)
        .getPublicUrl(path);
      url = urlData.publicUrl;
    }

    return {
      path: data.path,
      bucket,
      url,
      size: file.size,
      contentType: file.type,
    };
  }

  /**
   * Get a signed URL for private file access.
   */
  async getSignedUrl(
    bucket: BucketName,
    path: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      throw new Error(`Failed to get signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  /**
   * Delete a file from storage.
   */
  async delete(bucket: BucketName, path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
  }

  /**
   * List files in user's folder.
   */
  async listFiles(
    bucket: BucketName,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Array<{ name: string; size: number; createdAt: string }>> {
    const userId = (await this.supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .list(userId, {
        limit: options.limit || 100,
        offset: options.offset || 0,
      });

    if (error) {
      throw new Error(`List failed: ${error.message}`);
    }

    return data.map((file) => ({
      name: file.name,
      size: file.metadata?.size || 0,
      createdAt: file.created_at,
    }));
  }

  /**
   * Get public URL for avatars.
   */
  getPublicUrl(bucket: 'avatars', path: string): string {
    const { data } = this.supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}

export const storageClient = new StorageClient();
```

### 6. apps/web/lib/storage/hooks.ts

```typescript
/**
 * React hooks for file uploads.
 */

'use client';

import { useState, useCallback } from 'react';
import { storageClient, type BucketName, type UploadResult } from './client';

export interface UseUploadOptions {
  bucket: BucketName;
  maxSize?: number;
  allowedTypes?: string[];
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
}

export interface UseUploadReturn {
  upload: (file: File) => Promise<UploadResult | null>;
  isUploading: boolean;
  progress: number;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook for file uploads with progress tracking.
 */
export function useUpload(options: UseUploadOptions): UseUploadReturn {
  const { bucket, maxSize, allowedTypes, onSuccess, onError } = options;
  
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setIsUploading(false);
    setProgress(0);
    setError(null);
  }, []);

  const upload = useCallback(async (file: File): Promise<UploadResult | null> => {
    // Validate file size
    if (maxSize && file.size > maxSize) {
      const err = new Error(`File too large. Maximum size is ${maxSize / (1024 * 1024)}MB`);
      setError(err);
      onError?.(err);
      return null;
    }

    // Validate file type
    if (allowedTypes && !allowedTypes.includes(file.type)) {
      const err = new Error(`File type not allowed: ${file.type}`);
      setError(err);
      onError?.(err);
      return null;
    }

    setIsUploading(true);
    setProgress(0);
    setError(null);

    try {
      // Simulate progress (Supabase doesn't provide real progress)
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 100);

      const result = await storageClient.upload(bucket, file, {
        onProgress: setProgress,
      });

      clearInterval(progressInterval);
      setProgress(100);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Upload failed');
      setError(error);
      onError?.(error);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [bucket, maxSize, allowedTypes, onSuccess, onError]);

  return { upload, isUploading, progress, error, reset };
}

/**
 * Hook for avatar uploads with automatic URL generation.
 */
export function useAvatarUpload(options: {
  onSuccess?: (url: string) => void;
  onError?: (error: Error) => void;
} = {}) {
  const { upload, isUploading, progress, error, reset } = useUpload({
    bucket: 'avatars',
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    onSuccess: (result) => {
      if (result.url) {
        options.onSuccess?.(result.url);
      }
    },
    onError: options.onError,
  });

  return { upload, isUploading, progress, error, reset };
}

/**
 * Hook for document uploads with signed URL generation.
 */
export function useDocumentUpload(options: {
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
} = {}) {
  return useUpload({
    bucket: 'documents',
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}
```

### 7. apps/web/lib/storage/index.ts

```typescript
export * from './client';
export * from './hooks';
```

### 8. apps/web/components/ui/file-upload.tsx

```typescript
'use client';

import { useCallback, useState, useRef, type ChangeEvent, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSize?: number;
  disabled?: boolean;
  isUploading?: boolean;
  progress?: number;
  error?: string | null;
  className?: string;
}

export function FileUpload({
  onFileSelect,
  accept,
  maxSize,
  disabled,
  isUploading,
  progress = 0,
  error,
  className,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      
      const file = e.dataTransfer.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div className={cn('w-full', className)}>
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-300 hover:border-gray-400',
          disabled && 'opacity-50 cursor-not-allowed',
          error && 'border-red-300 bg-red-50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          disabled={disabled || isUploading}
          className="hidden"
        />

        {isUploading ? (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">Uploading...</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500">{progress}%</div>
          </div>
        ) : (
          <>
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="mt-4">
              <span className="text-primary-600 font-medium">Click to upload</span>
              <span className="text-gray-500"> or drag and drop</span>
            </div>
            {accept && (
              <p className="mt-1 text-xs text-gray-500">
                {accept.split(',').join(', ')}
              </p>
            )}
            {maxSize && (
              <p className="mt-1 text-xs text-gray-500">
                Max size: {maxSize / (1024 * 1024)}MB
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
```

---

## Storage Testing

### 9. packages/backend/tests/storage/__init__.py

```python
"""Storage tests package."""
```

### 10. packages/backend/tests/storage/test_service.py

```python
"""
Storage service tests.
"""

import pytest
from unittest.mock import MagicMock, AsyncMock
from io import BytesIO

from src.storage.service import StorageService, StorageError


class TestStorageService:
    """Tests for StorageService."""
    
    @pytest.fixture
    def mock_supabase(self):
        """Create mock Supabase client."""
        mock = MagicMock()
        mock.storage.from_.return_value = mock
        mock.upload.return_value = {"path": "user-123/file.jpg"}
        mock.get_public_url.return_value = "https://example.com/file.jpg"
        mock.create_signed_url.return_value = {"signedURL": "https://example.com/signed"}
        mock.remove.return_value = None
        mock.list.return_value = []
        return mock
    
    @pytest.fixture
    def service(self, mock_supabase):
        return StorageService(mock_supabase)
    
    @pytest.mark.asyncio
    async def test_upload_success(self, service, mock_supabase):
        """Should upload file successfully."""
        file = BytesIO(b"\xff\xd8\xff" + b"x" * 1000)  # JPEG magic bytes
        
        result = await service.upload(
            bucket="avatars",
            user_id="user-123",
            file=file,
            filename="photo.jpg",
        )
        
        assert result["bucket"] == "avatars"
        assert "user-123" in result["path"]
        assert result["content_type"] == "image/jpeg"
    
    @pytest.mark.asyncio
    async def test_upload_invalid_bucket(self, service):
        """Should reject invalid bucket."""
        file = BytesIO(b"test content")
        
        with pytest.raises(StorageError) as exc:
            await service.upload(
                bucket="invalid",
                user_id="user-123",
                file=file,
                filename="test.txt",
            )
        
        assert exc.value.code == "INVALID_BUCKET"
    
    @pytest.mark.asyncio
    async def test_upload_file_too_large(self, service):
        """Should reject files exceeding size limit."""
        # Create file larger than avatar limit (5MB)
        file = BytesIO(b"x" * (6 * 1024 * 1024))
        
        with pytest.raises(StorageError):
            await service.upload(
                bucket="avatars",
                user_id="user-123",
                file=file,
                filename="large.jpg",
                content_type="image/jpeg",
            )
    
    @pytest.mark.asyncio
    async def test_upload_invalid_type(self, service):
        """Should reject invalid file types."""
        file = BytesIO(b"test content")
        
        with pytest.raises(StorageError):
            await service.upload(
                bucket="avatars",
                user_id="user-123",
                file=file,
                filename="test.exe",
                content_type="application/x-msdownload",
            )
    
    @pytest.mark.asyncio
    async def test_get_signed_url(self, service, mock_supabase):
        """Should generate signed URL."""
        url = await service.get_signed_url(
            bucket="documents",
            path="user-123/doc.pdf",
            expires_in=3600,
        )
        
        assert "signed" in url
    
    @pytest.mark.asyncio
    async def test_delete(self, service, mock_supabase):
        """Should delete file."""
        result = await service.delete(
            bucket="uploads",
            path="user-123/file.txt",
        )
        
        assert result is True
        mock_supabase.storage.from_.return_value.remove.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_list_files(self, service, mock_supabase):
        """Should list user files."""
        mock_supabase.storage.from_.return_value.list.return_value = [
            {"name": "file1.txt", "metadata": {"size": 100}},
            {"name": "file2.txt", "metadata": {"size": 200}},
        ]
        
        files = await service.list_files(
            bucket="uploads",
            user_id="user-123",
        )
        
        assert len(files) == 2
    
    @pytest.mark.asyncio
    async def test_get_public_url(self, service, mock_supabase):
        """Should get public URL for public bucket."""
        url = await service.get_public_url(
            bucket="avatars",
            path="user-123/avatar.jpg",
        )
        
        assert url is not None
    
    @pytest.mark.asyncio
    async def test_get_public_url_private_bucket(self, service):
        """Should reject public URL for private bucket."""
        with pytest.raises(StorageError) as exc:
            await service.get_public_url(
                bucket="documents",
                path="user-123/doc.pdf",
            )
        
        assert exc.value.code == "NOT_PUBLIC"
```

### 11. packages/backend/tests/storage/test_validation.py

```python
"""
File validation tests.
"""

import pytest

from src.storage.validation import (
    validate_file,
    validate_image,
    get_mime_type,
    FileValidationError,
)


class TestGetMimeType:
    """Tests for get_mime_type."""
    
    def test_detects_jpeg_from_magic_bytes(self):
        content = b"\xff\xd8\xff" + b"x" * 100
        assert get_mime_type("unknown", content) == "image/jpeg"
    
    def test_detects_png_from_magic_bytes(self):
        content = b"\x89PNG\r\n\x1a\n" + b"x" * 100
        assert get_mime_type("unknown", content) == "image/png"
    
    def test_detects_pdf_from_magic_bytes(self):
        content = b"%PDF-1.4" + b"x" * 100
        assert get_mime_type("unknown", content) == "application/pdf"
    
    def test_falls_back_to_extension(self):
        assert get_mime_type("document.pdf") == "application/pdf"
        assert get_mime_type("image.jpg") == "image/jpeg"
    
    def test_returns_octet_stream_for_unknown(self):
        assert get_mime_type("file.xyz") == "application/octet-stream"


class TestValidateFile:
    """Tests for validate_file."""
    
    def test_accepts_valid_file(self):
        content = b"\xff\xd8\xff" + b"x" * 1000
        validate_file(
            content=content,
            filename="photo.jpg",
            content_type="image/jpeg",
            max_size=5 * 1024 * 1024,
            allowed_types={"image/jpeg", "image/png"},
        )
    
    def test_rejects_oversized_file(self):
        content = b"x" * (6 * 1024 * 1024)
        
        with pytest.raises(FileValidationError) as exc:
            validate_file(
                content=content,
                filename="large.jpg",
                content_type="image/jpeg",
                max_size=5 * 1024 * 1024,
                allowed_types=None,
            )
        
        assert exc.value.code == "FILE_TOO_LARGE"
    
    def test_rejects_empty_file(self):
        with pytest.raises(FileValidationError) as exc:
            validate_file(
                content=b"",
                filename="empty.txt",
                content_type="text/plain",
                max_size=1024,
                allowed_types=None,
            )
        
        assert exc.value.code == "EMPTY_FILE"
    
    def test_rejects_dangerous_extension(self):
        with pytest.raises(FileValidationError) as exc:
            validate_file(
                content=b"malicious",
                filename="virus.exe",
                content_type="application/x-msdownload",
                max_size=1024,
                allowed_types=None,
            )
        
        assert exc.value.code == "DANGEROUS_FILE_TYPE"
    
    def test_rejects_disallowed_type(self):
        with pytest.raises(FileValidationError) as exc:
            validate_file(
                content=b"text content",
                filename="doc.txt",
                content_type="text/plain",
                max_size=1024,
                allowed_types={"image/jpeg", "image/png"},
            )
        
        assert exc.value.code == "INVALID_FILE_TYPE"
    
    def test_allows_all_types_when_none(self):
        validate_file(
            content=b"any content",
            filename="file.xyz",
            content_type="application/octet-stream",
            max_size=1024,
            allowed_types=None,
        )


class TestValidateImage:
    """Tests for validate_image."""
    
    def test_accepts_valid_image(self):
        # Minimal valid JPEG
        content = b"\xff\xd8\xff" + b"x" * 100
        result = validate_image(content, "photo.jpg")
        assert result["content_type"] == "image/jpeg"
    
    def test_rejects_non_image(self):
        with pytest.raises(FileValidationError):
            validate_image(b"not an image", "file.txt")
    
    def test_rejects_oversized_image(self):
        content = b"\xff\xd8\xff" + b"x" * (11 * 1024 * 1024)
        
        with pytest.raises(FileValidationError) as exc:
            validate_image(content, "large.jpg", max_size=10 * 1024 * 1024)
        
        assert exc.value.code == "FILE_TOO_LARGE"
```

---

## Verification

After creating all files, run:

```bash
node Masterguide/scaffolding/scripts/verify-phase.js 13
```

**Manual checks:**

```bash
# 1. Apply storage migration
supabase db push

# 2. Run storage tests
cd packages/backend
pytest tests/storage/ -v

# 3. Test upload in browser
# Start dev server and test file upload component
```

**Success Criteria**:
- [ ] Storage buckets created in Supabase
- [ ] RLS policies applied
- [ ] Upload service handles all file types
- [ ] Validation rejects dangerous files
- [ ] Frontend upload component works
- [ ] All storage tests pass

---

## Next Phase

Proceed to [14-CACHING.md](./14-CACHING.md) for Redis caching patterns.
