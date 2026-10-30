# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-30

### Changed

- Microsoft account sign-in now opens in an app sign-in window with an account picker, instead of the default browser profile. Default-browser sign-in is still available.

## [1.0.0] - 2026-10-29

Initial public release.

### Added

- Sign-in with a browser (Microsoft Entra ID via MSAL) or an existing Azure CLI session, with directory (tenant) switching.
- Discovery of Azure Firewalls and Firewall Policies across subscriptions using Azure Resource Graph.
- Editing of rule collection groups, rule collections, and DNAT, network, and application rules, with IP Group, service tag, FQDN tag, and web category lookups.
- Draft (candidate) workflow: changes are staged locally and persist across restarts until committed.
- Risk review and per-group diffs before committing, with detection of concurrent changes made in Azure.
- Local commit history.
- Flow tester to find which rule matches a given flow.
- CSV import and export of rules.
- Wizard to deploy a new Azure Firewall and Firewall Policy.
- Encrypted, OS key store–backed token cache.
- Portable, no-install executables for Windows (x64 and Arm64 `.exe`), macOS (zipped `.app`, arm64 and x64), and Linux (x64 AppImage).

[Unreleased]: https://github.com/samsmith-MSFT/ez-azfw-ruleman/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/samsmith-MSFT/ez-azfw-ruleman/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/samsmith-MSFT/ez-azfw-ruleman/releases/tag/v1.0.0
