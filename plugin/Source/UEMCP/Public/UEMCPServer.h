// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "HAL/CriticalSection.h"
#include "Interfaces/IPv4/IPv4Endpoint.h"
#include "Misc/Guid.h"
#include "Templates/UniquePtr.h"

class FTcpListener;
class FSocket;
class FUEMCPClientConnection;

/**
 * Owns the TCP listener and the set of live client connections.
 * Lives on the game thread; its tick reaps finished client threads safely
 * (no thread can self-delete from the Connections map while still running).
 */
class UEMCP_API FUEMCPServer : public FTSTickerObjectBase
{
public:
	FUEMCPServer();
	virtual ~FUEMCPServer();

	/** Start the TCP listener. Returns true on success. */
	bool Start(const FString& Host, int32 PreferredPort);

	/** Tear down listener and drop all connections. Safe to call multiple times. */
	void Stop();

	bool IsActive() const { return Listener.IsValid(); }
	int32 GetActualPort() const { return ActualPort; }

	/** Called from a client-connection thread when Run() is about to return. */
	void MarkConnectionDead(const FGuid& ConnectionId);

	// FTSTickerObjectBase
	virtual bool Tick(float DeltaTime) override;

private:
	bool HandleAccept(FSocket* ClientSocket, const FIPv4Endpoint& Endpoint);

	TUniquePtr<FTcpListener> Listener;
	int32 ActualPort = 0;

	mutable FCriticalSection ConnectionsMutex;
	TMap<FGuid, TUniquePtr<FUEMCPClientConnection>> Connections;
	TArray<FGuid> PendingDead;
};
