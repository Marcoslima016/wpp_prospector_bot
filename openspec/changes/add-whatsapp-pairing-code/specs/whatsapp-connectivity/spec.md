## MODIFIED Requirements

### Requirement: Unofficial session-based WhatsApp connection
The system SHALL connect to WhatsApp through an unofficial, session-based mechanism authenticated via QR code or pairing code, rather than the official WhatsApp Business Cloud API.

#### Scenario: Pairing a new WhatsApp number
- **WHEN** an administrator adds a new WhatsApp number to the platform without configuring a pairing number
- **THEN** the system presents a QR code for that number's WhatsApp app to scan, and establishes an authenticated session upon successful pairing

#### Scenario: Pairing a new WhatsApp number via pairing code
- **WHEN** an administrator adds a new WhatsApp number to the platform with a pairing number configured for that session
- **THEN** the system requests a pairing code for that number instead of presenting a QR code, and establishes an authenticated session once the code is entered on that number's WhatsApp app

#### Scenario: Pairing code not re-requested for an already-registered session
- **WHEN** a session with a pairing number configured restarts and its credentials are already registered from a previous pairing
- **THEN** the system does not request a new pairing code, and resumes the session the same way an already-registered QR-paired session would
