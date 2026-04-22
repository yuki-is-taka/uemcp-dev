// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Wire-protocol version shared with the uemcp Node shim. Bump the major when
// changing: envelope shape, discovery file format, error shape, handshake
// behavior. Do NOT bump for tool additions or schema changes — those are
// discovered at runtime. See docs/PROTOCOL.md in the dev monorepo.

#pragma once

#define UEMCP_PROTOCOL_VERSION_MAJOR 0
#define UEMCP_PROTOCOL_VERSION_MINOR 1
#define UEMCP_PROTOCOL_VERSION_PATCH 0
#define UEMCP_PROTOCOL_VERSION_STRING TEXT("0.1.0")

#define UEMCP_PLUGIN_VERSION TEXT("0.1.0")
