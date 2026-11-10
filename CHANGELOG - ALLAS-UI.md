# Changelog

All notable changes to this project will be documented in this file.

## 2026-11-04

### Fixed

- A bucket that the web interface can't list (e.g. a bucket policy blocks it) no longer causes a /browse → /forbid redirect loop. The bucket is labelled "Unavailable" instead.

## 2025-01-28

### Changed

- 5GiB limit for downloads of folders / buckets

## 2025-01-27

### Fixed

-  Segment bucket overwrite size of normal buckets bug fixed.

## 2025-01-21

### Fixed

-  Bucket size bigger than 1TiB inconstant bug fixed.

## 2024-10-24

### Changed

-  local `csc-ui` npm package was uploaded publicly and was named `allas-ui`. using the public package - https://www.npmjs.com/package/allas-ui?activeTab=readme

## 2024-10-21

### Added

- UI color change
