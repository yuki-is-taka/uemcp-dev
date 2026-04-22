// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#pragma once

#include "CoreMinimal.h"
#include "HAL/CriticalSection.h"
#include "HAL/Runnable.h"
#include "HAL/ThreadSafeBool.h"
#include "Interfaces/IPv4/IPv4Endpoint.h"
#include "Misc/Guid.h"
#include "Templates/UniquePtr.h"

class FSocket;
class FRunnableThread;
class FUEMCPServer;
class FJsonObject;

/**
 * One TCP client connection. Owns its socket and a dedicated read-loop thread.
 * Reads newline-delimited JSON-RPC 2.0 messages, dispatches mcp.handshake /
 * mcp.list_tools / mcp.call_tool, and writes responses back on the same socket.
 *
 * Tool execution is dispatched to the game thread via AsyncTask and awaited
 * via TFuture with a configurable timeout (from UUEMCPSettings).
 */
class UEMCP_API FUEMCPClientConnection : public FRunnable
{
public:
	FUEMCPClientConnection(FSocket* InSocket, const FIPv4Endpoint& InEndpoint,
		const FGuid& InId, FUEMCPServer* InServer);
	virtual ~FUEMCPClientConnection();

	bool StartThread();
	const FGuid& GetId() const { return Id; }

	// FRunnable
	virtual uint32 Run() override;
	virtual void Stop() override;
	virtual void Exit() override;

private:
	void ProcessLine(const FString& Line);

	TSharedRef<FJsonObject> HandleHandshake(int32 RequestId, const TSharedPtr<FJsonObject>& Params);
	TSharedRef<FJsonObject> HandleListTools(int32 RequestId);
	TSharedRef<FJsonObject> HandleCallTool(int32 RequestId, const TSharedPtr<FJsonObject>& Params);
	TSharedRef<FJsonObject> ExecutePythonTool(int32 RequestId, const TSharedPtr<FJsonObject>& Args);

	bool WriteJson(const TSharedRef<FJsonObject>& Obj);
	bool WriteRaw(const FString& LineWithNewline);

	FSocket* Socket;
	FIPv4Endpoint ClientEndpoint;
	FGuid Id;
	FUEMCPServer* Server;

	TUniquePtr<FRunnableThread> Thread;
	FThreadSafeBool bStopRequested;
	FCriticalSection WriteMutex;

	// Handshake state (touched only from the read-loop thread)
	bool bHandshakeComplete = false;
	FGuid SessionId;

	TArray<uint8> ReadBuffer;
};
