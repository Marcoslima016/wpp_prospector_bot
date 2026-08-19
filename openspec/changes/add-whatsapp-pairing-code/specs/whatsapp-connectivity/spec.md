## MODIFIED Requirements

### Requirement: Unofficial session-based WhatsApp connection
The system SHALL connect to WhatsApp through an unofficial, session-based mechanism authenticated via QR code or pairing code, rather than the official WhatsApp Business Cloud API. The operator selects which method to use via an interactive prompt shown when the process starts.

#### Scenario: Pairing a new WhatsApp number
- **WHEN** an administrator starts a new session and selects the QR code option at the interactive prompt (the default when no explicit choice is made)
- **THEN** the system presents a QR code for that number's WhatsApp app to scan, and establishes an authenticated session upon successful pairing

#### Scenario: Pairing a new WhatsApp number via pairing code
- **WHEN** an administrator starts a new session and selects the pairing code option at the interactive prompt, providing a phone number (or accepting a pre-configured default)
- **THEN** the system requests a pairing code for that number instead of presenting a QR code, and establishes an authenticated session once the code is entered on that number's WhatsApp app

#### Scenario: Pairing code not re-requested for an already-registered session
- **WHEN** a session that selects the pairing code option restarts and its credentials are already registered from a previous pairing (via either QR code or pairing code)
- **THEN** the system does not request a new pairing code, and resumes the session the same way an already-registered QR-paired session would

### Requirement: Automatic reconnection on disconnect
The system SHALL detect unexpected session disconnection and attempt automatic reconnection without manual intervention, and SHALL report the reason for the disconnection so an operator can diagnose it without needing to add ad-hoc instrumentation.

#### Scenario: Unexpected disconnect
- **WHEN** an active WhatsApp session disconnects unexpectedly (e.g., network interruption)
- **THEN** the system attempts to reconnect the session automatically and resumes sending/receiving once reconnected

#### Scenario: Disconnect reason surfaced to the operator
- **WHEN** a WhatsApp session disconnects for any reason other than an intentional stop
- **THEN** the system prints a description of the disconnect - including the status code, the underlying message, and any additional server-provided detail - to the terminal
