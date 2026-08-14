# anti-ban-warmup Specification

## Purpose

Define the rules that govern how connected WhatsApp numbers ramp up and sustain outbound message volume safely, keeping the operation within the product's 100 disparos/dia target without triggering blocks or bans on the unofficial connection.

## Requirements

### Requirement: Gradual warmup ramp for new numbers
A newly connected WhatsApp number SHALL NOT send at full target volume immediately; the system SHALL increase that number's allowed daily send volume gradually over a defined warmup period until it reaches its share of the sustained daily target.

#### Scenario: Day one of a newly paired number
- **WHEN** a WhatsApp number completes pairing for the first time
- **THEN** the system limits that number's outbound messages on day one to a small fraction of the 100/day target, not the full target

#### Scenario: Number reaches full warmup
- **WHEN** a number has been active and healthy through the full warmup period
- **THEN** the system allows that number to send at its full sustained daily allotment toward the 100 disparos/dia target

### Requirement: Throttled send cadence with jitter
The system SHALL space outbound messages with a randomized (jittered) delay between sends, rather than a fixed interval, to avoid a mechanical sending pattern.

#### Scenario: Sending a batch of campaign messages
- **WHEN** the system sends multiple outbound messages in sequence
- **THEN** the delay between consecutive sends varies rather than being constant

### Requirement: Presence simulation during send
The system SHALL simulate human-like presence signals (e.g., a composing/typing indicator, marking received messages as read) around outbound sends.

#### Scenario: Sending a message to a lead
- **WHEN** the system sends an outbound message to a lead
- **THEN** it emits a "composing" presence signal before the message is delivered, consistent with human typing behavior

### Requirement: Daily volume ceiling enforcement
The system SHALL enforce a hard ceiling on total outbound messages sent per day across all connected WhatsApp numbers, aligned with the product's definitive target of 100 disparos/dia, and SHALL NOT send beyond that ceiling regardless of campaign demand.

#### Scenario: Campaign demand exceeds the daily ceiling
- **WHEN** queued campaign messages for a given day exceed the enforced daily ceiling
- **THEN** the system defers the excess messages to a subsequent day rather than exceeding the ceiling
