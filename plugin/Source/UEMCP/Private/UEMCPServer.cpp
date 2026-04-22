// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#include "UEMCPServer.h"
#include "UEMCPClientConnection.h"
#include "UEMCPModule.h"

#include "Common/TcpListener.h"
#include "IPAddress.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "SocketSubsystem.h"
#include "Sockets.h"

FUEMCPServer::FUEMCPServer() = default;

FUEMCPServer::~FUEMCPServer()
{
	Stop();
}

bool FUEMCPServer::Start(const FString& Host, int32 PreferredPort)
{
	FIPv4Address IpAddr;
	if (!FIPv4Address::Parse(Host, IpAddr))
	{
		UE_LOG(LogUEMCP, Error, TEXT("Invalid listen host '%s'"), *Host);
		return false;
	}

	const FIPv4Endpoint Endpoint(IpAddr, static_cast<uint16>(PreferredPort));
	Listener = MakeUnique<FTcpListener>(Endpoint);

	if (!Listener->IsActive())
	{
		UE_LOG(LogUEMCP, Error, TEXT("Failed to bind TCP listener on %s (port may be in use)"), *Endpoint.ToString());
		Listener.Reset();
		return false;
	}

	Listener->OnConnectionAccepted().BindRaw(this, &FUEMCPServer::HandleAccept);

	// GetLocalEndpoint() returns the *requested* endpoint (port 0 on auto-bind).
	// Query the socket itself to get the actual OS-assigned port.
	ActualPort = 0;
	if (FSocket* const ListenSocket = Listener->GetSocket())
	{
		if (ISocketSubsystem* const SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM))
		{
			const TSharedRef<FInternetAddr> BoundAddr = SocketSubsystem->CreateInternetAddr();
			ListenSocket->GetAddress(*BoundAddr);
			ActualPort = BoundAddr->GetPort();
		}
	}
	if (ActualPort == 0)
	{
		UE_LOG(LogUEMCP, Error, TEXT("UEMCP listener bound but failed to read back actual port"));
		Listener->OnConnectionAccepted().Unbind();
		Listener.Reset();
		return false;
	}

	UE_LOG(LogUEMCP, Log, TEXT("UEMCP listener bound on %s:%d"), *Host, ActualPort);
	return true;
}

void FUEMCPServer::Stop()
{
	if (Listener)
	{
		Listener->OnConnectionAccepted().Unbind();
		Listener.Reset(); // FTcpListener destructor joins its accept thread
	}

	{
		FScopeLock Lock(&ConnectionsMutex);
		// Destroying each connection joins its thread. May block briefly.
		Connections.Empty();
		PendingDead.Empty();
	}

	ActualPort = 0;
}

bool FUEMCPServer::HandleAccept(FSocket* ClientSocket, const FIPv4Endpoint& Endpoint)
{
	// Runs on FTcpListener's accept thread.
	if (!ClientSocket)
	{
		return false;
	}

	const FGuid Id = FGuid::NewGuid();
	TUniquePtr<FUEMCPClientConnection> Conn = MakeUnique<FUEMCPClientConnection>(ClientSocket, Endpoint, Id, this);
	if (!Conn->StartThread())
	{
		UE_LOG(LogUEMCP, Error, TEXT("Failed to start client thread for %s"), *Endpoint.ToString());
		return false; // Caller will close the socket
	}

	UE_LOG(LogUEMCP, Verbose, TEXT("UEMCP client connected from %s (id=%s)"), *Endpoint.ToString(),
		*Id.ToString(EGuidFormats::DigitsWithHyphens));

	FScopeLock Lock(&ConnectionsMutex);
	Connections.Add(Id, MoveTemp(Conn));
	return true; // We retain ownership of the socket via Conn
}

void FUEMCPServer::MarkConnectionDead(const FGuid& ConnectionId)
{
	FScopeLock Lock(&ConnectionsMutex);
	PendingDead.AddUnique(ConnectionId);
}

bool FUEMCPServer::Tick(float DeltaTime)
{
	TArray<TUniquePtr<FUEMCPClientConnection>> ToDestroy;
	{
		FScopeLock Lock(&ConnectionsMutex);
		if (PendingDead.Num() == 0)
		{
			return true;
		}
		for (const FGuid& Id : PendingDead)
		{
			TUniquePtr<FUEMCPClientConnection> Conn;
			if (Connections.RemoveAndCopyValue(Id, Conn))
			{
				ToDestroy.Add(MoveTemp(Conn));
			}
		}
		PendingDead.Empty();
	}
	// Destroy outside the lock to avoid blocking accept thread while joining.
	ToDestroy.Empty();
	return true;
}
