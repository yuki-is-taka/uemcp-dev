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
	FUEMCPModule();
	virtual ~FUEMCPModule();

	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	static FUEMCPModule& Get();

	FUEMCPServer* GetServer() const;

private:
	// Pimpl-style: TUniquePtr<IncompleteType> needs the destructor instantiated
	// in a TU where the type is complete. We declare ctor/dtor here and define
	// them in the .cpp so this header doesn't have to pull in UEMCPServer.h.
	TUniquePtr<FUEMCPServer> Server;
};
