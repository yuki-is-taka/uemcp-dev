// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "UEMCPSettings.generated.h"

UCLASS(Config = EditorPerProjectUserSettings, DefaultConfig, meta = (DisplayName = "UEMCP"))
class UEMCP_API UUEMCPSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	virtual FName GetCategoryName() const override { return TEXT("Plugins"); }

	/** Master switch. Disables the TCP server when off (discovery file is still written so the shim can see the editor is present). */
	UPROPERTY(EditAnywhere, Config, Category = "UEMCP")
	bool bEnable = true;

	/** Address the TCP server binds to. Default is loopback-only for safety. */
	UPROPERTY(EditAnywhere, Config, Category = "UEMCP|Network")
	FString ListenHost = TEXT("127.0.0.1");

	/** Preferred TCP port. 0 = let the OS assign a free port (recommended to avoid collisions across editors). */
	UPROPERTY(EditAnywhere, Config, Category = "UEMCP|Network", meta = (ClampMin = 0, ClampMax = 65535))
	int32 PreferredPort = 0;

	/** Maximum time the server waits for `execute_python` to return before responding with a timeout error. The Python call itself keeps running on the game thread. */
	UPROPERTY(EditAnywhere, Config, Category = "UEMCP|Execution", meta = (ClampMin = 1.0))
	float ExecutePythonTimeoutSeconds = 30.0f;
};
