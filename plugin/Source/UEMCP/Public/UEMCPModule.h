// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleInterface.h"
#include "Templates/UniquePtr.h"

class FUEMCPServer;

DECLARE_LOG_CATEGORY_EXTERN(LogUEMCP, Log, All);

class UEMCP_API FUEMCPModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	static FUEMCPModule& Get();

	FUEMCPServer* GetServer() const { return Server.Get(); }

private:
	TUniquePtr<FUEMCPServer> Server;
};
