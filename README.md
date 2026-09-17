# KiranaLedger: Agentic Bill Extraction & Ledger Assistant

Built for First Commit, the opening hackathon of AWS's Bharat Builds Tour by WeMakeDevs (Sept 17 to 20, 2026).
Track: Ship It

## The Problem

Small shop owners handle supplier bills manually. They photograph or keep paper copies, then tally totals into a notebook or spreadsheet by hand at the end of the day. There is no easy way to catch a duplicate bill, a price that has jumped from last time, or a payment that is coming due, until it is already a problem.

## What We Built

A shop owner photographs a supplier bill. The system extracts the line items, checks them against the existing ledger for duplicates or unusual price changes, updates stock and ledger records, and flags anything that needs attention, such as an approaching due date or a price spike.

Flow: photo upload > extraction > reasoning and flagging > ledger update > alert

## Where AWS Fits

| Stage | AWS Service |
|---|---|
| Bill photo upload | Amazon S3 |
| Line item extraction (vision) | Amazon Bedrock |
| Reasoning: duplicate and price jump detection, flagging | Bedrock Agents / Lambda |
| Ledger storage | Amazon DynamoDB |
| Alerts and reminders | EventBridge |
| Hosting | Amplify Hosting / App Runner |

## Team

| Name | Role |
|---|---|
| Khushi | Ingestion and extraction: S3 upload, Bedrock vision extraction pipeline |
| Pranav | Reasoning, ledger and UI: flagging logic, DynamoDB ledger, frontend |

## Tech Stack

- AWS: S3, Bedrock, DynamoDB, Lambda, EventBridge, Amplify (adjust as finalized)
- [Frontend framework, fill in]
- [Backend language/framework, fill in]

## Getting Started

\`\`\`bash
git clone https://github.com/<your-org-or-username>/kiranaledger.git
cd kiranaledger
# setup instructions, fill in as the stack is finalized
\`\`\`

## AI Tools Used

(Required disclosure per hackathon rules. List every AI coding assistant used, for example Claude Code or GitHub Copilot.)

- [Tool name(s)]

## Demo Video

[Link to be added. Under 3 minutes, YouTube, public or unlisted]

## Writeup

[Link to AWS Builder Center article to be added]

## License

MIT License

---

Built for [First Commit](https://www.wemakedevs.org/aws/first-commit), Bharat Builds Tour, WeMakeDevs x AWS.
