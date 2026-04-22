// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#include "UEMCPDiscoveryFile.h"
#include "UEMCPModule.h"
#include "UEMCPProtocol.h"

#include "Dom/JsonObject.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformProcess.h"
#include "Misc/App.h"
#include "Misc/DateTime.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

FString FUEMCPDiscoveryFile::GetDiscoveryDir()
{
#if PLATFORM_WINDOWS
	const FString LocalAppData = FPlatformMisc::GetEnvironmentVariable(TEXT("LOCALAPPDATA"));
	if (LocalAppData.IsEmpty())
	{
		return FString();
	}
	return FPaths::Combine(LocalAppData, TEXT("UnrealMcp"), TEXT("instances"));
#elif PLATFORM_MAC
	const FString Home = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
	if (Home.IsEmpty())
	{
		return FString();
	}
	return FPaths::Combine(Home, TEXT("Library"), TEXT("Application Support"), TEXT("UnrealMcp"), TEXT("instances"));
#else
	FString XdgState = FPlatformMisc::GetEnvironmentVariable(TEXT("XDG_STATE_HOME"));
	if (XdgState.IsEmpty())
	{
		const FString Home = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
		if (Home.IsEmpty())
		{
			return FString();
		}
		XdgState = FPaths::Combine(Home, TEXT(".local"), TEXT("state"));
	}
	return FPaths::Combine(XdgState, TEXT("UnrealMcp"), TEXT("instances"));
#endif
}

FString FUEMCPDiscoveryFile::GetDiscoveryFilePath()
{
	const FString Dir = GetDiscoveryDir();
	if (Dir.IsEmpty())
	{
		return FString();
	}
	const uint32 Pid = FPlatformProcess::GetCurrentProcessId();
	return FPaths::Combine(Dir, FString::Printf(TEXT("%u.json"), Pid));
}

void FUEMCPDiscoveryFile::Write(int32 ListenPort)
{
	const FString FilePath = GetDiscoveryFilePath();
	if (FilePath.IsEmpty())
	{
		UE_LOG(LogUEMCP, Warning, TEXT("Could not determine discovery file path (home/LOCALAPPDATA missing?)"));
		return;
	}

	IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
	const FString Dir = FPaths::GetPath(FilePath);
	if (!PlatformFile.DirectoryExists(*Dir))
	{
		PlatformFile.CreateDirectoryTree(*Dir);
	}

	TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
	Obj->SetStringField(TEXT("protocol_version"), UEMCP_PROTOCOL_VERSION_STRING);
	Obj->SetNumberField(TEXT("pid"), static_cast<double>(FPlatformProcess::GetCurrentProcessId()));
	Obj->SetStringField(TEXT("project_name"), FApp::GetProjectName());
	Obj->SetStringField(TEXT("project_path"), FPaths::ConvertRelativePathToFull(FPaths::ProjectDir()));
	Obj->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
	Obj->SetStringField(TEXT("host"), TEXT("127.0.0.1"));
	Obj->SetNumberField(TEXT("port"), ListenPort);
	Obj->SetStringField(TEXT("started_at"), FDateTime::UtcNow().ToIso8601());

	FString Output;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Output);
	if (!FJsonSerializer::Serialize(Obj, Writer))
	{
		UE_LOG(LogUEMCP, Warning, TEXT("Failed to serialize discovery JSON"));
		return;
	}

	if (FFileHelper::SaveStringToFile(Output, *FilePath))
	{
		UE_LOG(LogUEMCP, Log, TEXT("Wrote discovery file: %s"), *FilePath);
	}
	else
	{
		UE_LOG(LogUEMCP, Warning, TEXT("Failed to write discovery file: %s"), *FilePath);
	}
}

void FUEMCPDiscoveryFile::Remove()
{
	const FString FilePath = GetDiscoveryFilePath();
	if (FilePath.IsEmpty())
	{
		return;
	}

	IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
	if (PlatformFile.FileExists(*FilePath))
	{
		if (PlatformFile.DeleteFile(*FilePath))
		{
			UE_LOG(LogUEMCP, Log, TEXT("Removed discovery file: %s"), *FilePath);
		}
		else
		{
			UE_LOG(LogUEMCP, Warning, TEXT("Failed to remove discovery file: %s"), *FilePath);
		}
	}
}
