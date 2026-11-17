# Changelog

All notable changes to Placitum are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-10

### Fixed

- `fs.writeFile!` canonicalizes an existing symlink leaf and rejects a dangling
  symlink, so a write grant can no longer be escaped through a link.
- `curl!` refuses HTTP redirects instead of following them to an ungranted host.
- `curl!` sends the URL and request body on stdin, keeping credentials out of
  the process command line and removing the `ARG_MAX` body limit.
- Error excerpts keep the correct caret column in CRLF files.
- Runaway recursion stops with E501 instead of a raw Node stack overflow.

## [1.0.0] - 2026-09-23

First public release.
