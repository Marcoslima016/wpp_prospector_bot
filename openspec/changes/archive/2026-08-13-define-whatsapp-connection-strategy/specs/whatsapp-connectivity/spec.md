## Purpose

Define how the platform establishes and maintains a connection to WhatsApp for sending and receiving messages, given the decision to use an unofficial, session-based connection instead of the official WhatsApp Business Cloud API.

## ADDED Requirements

### Requirement: Unofficial session-based WhatsApp connection
The system SHALL connect to WhatsApp through an unofficial, session-based mechanism authenticated via QR code (or equivalent device-pairing flow), rather than the official WhatsApp Business Cloud API.

#### Scenario: Pairing a new WhatsApp number
- **WHEN** an administrator adds a new WhatsApp number to the platform
- **THEN** the system presents a QR code (or pairing code) for that number's WhatsApp app to scan, and establishes an authenticated session upon successful pairing

### Requirement: Session persistence across restarts
The system SHALL persist an authenticated session's credentials so that a platform restart or redeploy does not require re-pairing via QR code.

#### Scenario: Platform restart with an existing session
- **WHEN** the platform restarts and a WhatsApp number was previously paired
- **THEN** the system resumes the session automatically without requiring the administrator to scan a QR code again

### Requirement: Automatic reconnection on disconnect
The system SHALL detect unexpected session disconnection and attempt automatic reconnection without manual intervention.

#### Scenario: Unexpected disconnect
- **WHEN** an active WhatsApp session disconnects unexpectedly (e.g., network interruption)
- **THEN** the system attempts to reconnect the session automatically and resumes sending/receiving once reconnected

### Requirement: Bounded concurrent session count
The system SHALL be designed to operate with a small number of concurrently connected WhatsApp sessions (on the order of a handful), not a large pool of simultaneous numbers.

#### Scenario: Operating within the target scale
- **WHEN** the platform is sized for the product's definitive volume target of 100 disparos/dia
- **THEN** the number of concurrently connected WhatsApp sessions required to sustain that volume remains small, not requiring dozens or hundreds of simultaneous numbers
