"""Container and object replication handlers using aiohttp."""

import logging
import math
import os
from typing import Any

import aiohttp.web
import botocore.exceptions

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# Recommended 100MiB single copy limit
SINGLE_COPY_SIZE = 100 * 1024 * 1024
DEFAULT_PART_SIZE = 50 * 1024 * 1024
# See limits https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
MAX_PART_COUNT = 10000


class ObjectReplicator:
    """A class for replicating objects."""

    def __init__(
        self,
        s3client: Any,
        project: str,
        bucket: str,
        source_project: str,
        source_bucket: str,
        project_name: str = "",
        source_project_name: str = "",
    ) -> None:
        """Initialize object replicator."""
        self.s3client = s3client
        self.project = project
        self.bucket = bucket
        self.source_project = source_project
        self.source_bucket = source_bucket
        self.project_name = project_name
        self.source_project_name = source_project_name

    async def create_destination_bucket(self) -> None:
        """Create destination bucket required for copying."""
        # Destination bucket should not already exist
        try:
            await self.s3client.head_bucket(Bucket=self.bucket)
            raise aiohttp.web.HTTPConflict(text="Bucket already exists")
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == "404":
                # Create the destination bucket
                try:
                    await self.s3client.create_bucket(Bucket=self.bucket)
                    LOGGER.info(f"Created destination bucket {self.bucket}")
                except botocore.exceptions.ClientError:
                    raise aiohttp.web.HTTPInternalServerError(
                        text="Failed to create destination bucket"
                    )
            elif error_code == "403":
                raise aiohttp.web.HTTPConflict(
                    text="Bucket already exists (Access denied)"
                )
            else:
                raise aiohttp.web.HTTPInternalServerError(
                    text="Cannot create destination bucket"
                )

    async def _multipart_copy(self, obj: dict[str, Any]) -> None:
        """Make a multipart copy of an object."""
        size = obj["Size"]
        key = obj["Key"]

        upload_id = (
            await self.s3client.create_multipart_upload(
                Bucket=self.bucket,
                Key=key,
            )
        )["UploadId"]

        part_size = DEFAULT_PART_SIZE
        if size > part_size * MAX_PART_COUNT:
            part_size = math.ceil(size / MAX_PART_COUNT)
        parts = []
        part_number = 1
        byte_position = 0

        try:
            while byte_position < size:
                last_byte = min(byte_position + part_size - 1, size - 1)

                part = await self.s3client.upload_part_copy(
                    Bucket=self.bucket,
                    Key=key,
                    CopySource={
                        "Bucket": self.source_bucket,
                        "Key": key,
                    },
                    CopySourceRange=f"bytes={byte_position}-{last_byte}",
                    PartNumber=part_number,
                    UploadId=upload_id,
                )

                parts.append(
                    {
                        "ETag": part["CopyPartResult"]["ETag"],
                        "PartNumber": part_number,
                    }
                )

                byte_position += part_size
                part_number += 1

            await self.s3client.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts},
            )

        except Exception:
            await self.s3client.abort_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
            )
            raise

    async def _replicate_object(self, obj: dict[str, Any]) -> None:
        """Copy an object."""
        key = obj["Key"]

        if obj["Size"] <= SINGLE_COPY_SIZE:
            try:
                await self.s3client.copy_object(
                    CopySource={
                        "Bucket": self.source_bucket,
                        "Key": key,
                    },
                    Bucket=self.bucket,
                    Key=key,
                )
            except Exception as e:
                LOGGER.exception(f"Failed to copy {key}: {e}")
        else:
            try:
                await self._multipart_copy(obj)
            except Exception as e:
                LOGGER.exception(f"Failed to multipart-copy {key}: {e}")

    async def replicate_objects(self) -> None:
        """Copy all bucket objects."""
        paginator = self.s3client.get_paginator("list_objects_v2")

        async for page in paginator.paginate(Bucket=self.source_bucket):
            for obj in page.get("Contents", []):
                await self._replicate_object(obj)
        LOGGER.info(f"Replication task for {self.source_bucket} finished")