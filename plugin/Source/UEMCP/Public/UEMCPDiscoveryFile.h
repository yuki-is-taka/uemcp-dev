// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Writes a per-PID JSON file to the shared discovery directory so that
// the uemcp shim can enumerate running editors. See docs/PROTOCOL.md for
// the discovery file schema.

#pragma once

#include "CoreMinimal.h"

class FUEMCPDiscoveryFile
{
public:
	/** Write the discovery file for this editor instance. `ListenPort` = 0 means "not yet listening". */
	static void Write(int32 ListenPort = 0);

	/** Remove the discovery file for this editor instance. */
	static void Remove();

	/** Directory containing all editor discovery files on this machine. */
	static FString GetDiscoveryDir();

	/** Absolute path of this editor instance's discovery file. */
	static FString GetDiscoveryFilePath();
};
