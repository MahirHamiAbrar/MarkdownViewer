# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting
instead: **Security → Report a vulnerability** on the repository page. You will get a reply
within a few days.

Helpful details: the version, your platform, what an attacker can do, and steps or a sample
file that shows it.

## What counts

MarkdownEditor opens Markdown files that may come from someone else, so these are in scope:

- a document that runs script, reads files outside what it links to, or reaches the network
  without the user asking;
- a way for page content to read an API key, or to send one somewhere other than the provider
  it was saved for;
- a release file whose signature or checksum does not verify.

## Supported versions

Fixes go into the latest release.
