// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#include "UEMCPModule.h"
#include "UEMCPDiscoveryFile.h"
#include "UEMCPProtocol.h"
#include "UEMCPServer.h"
#include "UEMCPSettings.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY(LogUEMCP);

#define LOCTEXT_NAMESPACE "FUEMCPModule"

void FUEMCPModule::StartupModule()
{
	UE_LOG(LogUEMCP, Log,
		TEXT("UEMCP %s starting up (protocol %s)"),
		UEMCP_PLUGIN_VERSION,
		UEMCP_PROTOCOL_VERSION_STRING);

	// Always write the discovery file so the shim can at least see the editor.
	// Port=0 means "not yet listening"; we rewrite with the real port after
	// the TCP server binds successfully below.
	FUEMCPDiscoveryFile::Write(0);

	const UUEMCPSettings* Settings = GetDefault<UUEMCPSettings>();
	if (!Settings->bEnable)
	{
		UE_LOG(LogUEMCP, Log, TEXT("UEMCP disabled via settings; TCP server not started"));
		return;
	}

	Server = MakeUnique<FUEMCPServer>();
	if (Server->Start(Settings->ListenHost, Settings->PreferredPort))
	{
		FUEMCPDiscoveryFile::Write(Server->GetActualPort());
	}
	else
	{
		UE_LOG(LogUEMCP, Warning,
			TEXT("UEMCP: TCP server failed to start on %s:%d. Discovery file left at port=0."),
			*Settings->ListenHost, Settings->PreferredPort);
		Server.Reset();
	}
}

void FUEMCPModule::ShutdownModule()
{
	if (Server)
	{
		Server->Stop();
		Server.Reset();
	}

	FUEMCPDiscoveryFile::Remove();
	UE_LOG(LogUEMCP, Log, TEXT("UEMCP shutting down"));
}

FUEMCPModule& FUEMCPModule::Get()
{
	return FModuleManager::LoadModuleChecked<FUEMCPModule>(TEXT("UEMCP"));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FUEMCPModule, UEMCP)
