// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#include "UEMCPModule.h"
#include "UEMCPProtocol.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY(LogUEMCP);

#define LOCTEXT_NAMESPACE "FUEMCPModule"

void FUEMCPModule::StartupModule()
{
	UE_LOG(LogUEMCP, Log,
		TEXT("UEMCP %s starting up (protocol %s)"),
		UEMCP_PLUGIN_VERSION,
		UEMCP_PROTOCOL_VERSION_STRING);

	// TODO(0.2): scan exposed UClasses and build tool registry.
	// TODO(0.2): start TCP listener on loopback (OS-assigned port by default).
	// TODO(0.2): write discovery file to %LOCALAPPDATA%/UnrealMcp/instances/{pid}.json.
}

void FUEMCPModule::ShutdownModule()
{
	UE_LOG(LogUEMCP, Log, TEXT("UEMCP shutting down"));

	// TODO(0.2): remove discovery file, close listener, drop client connections.
}

FUEMCPModule& FUEMCPModule::Get()
{
	return FModuleManager::LoadModuleChecked<FUEMCPModule>(TEXT("UEMCP"));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FUEMCPModule, UEMCP)
