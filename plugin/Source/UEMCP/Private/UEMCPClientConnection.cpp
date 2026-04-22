// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

#include "UEMCPClientConnection.h"
#include "UEMCPModule.h"
#include "UEMCPProtocol.h"
#include "UEMCPServer.h"
#include "UEMCPSettings.h"

#include "Async/Async.h"
#include "Async/Future.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/RunnableThread.h"
#include "IPythonScriptPlugin.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "SocketSubsystem.h"
#include "Sockets.h"

namespace UEMCP
{
	static TSharedRef<FJsonObject> MakeJsonRpcResult(int32 Id, const TSharedRef<FJsonObject>& Result)
	{
		TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
		Obj->SetStringField(TEXT("jsonrpc"), TEXT("2.0"));
		Obj->SetNumberField(TEXT("id"), Id);
		Obj->SetObjectField(TEXT("result"), Result);
		return Obj;
	}

	static TSharedRef<FJsonObject> MakeJsonRpcError(int32 Id, int32 Code, const FString& Message,
		const TSharedPtr<FJsonObject>& Data = nullptr)
	{
		TSharedRef<FJsonObject> Err = MakeShared<FJsonObject>();
		Err->SetNumberField(TEXT("code"), Code);
		Err->SetStringField(TEXT("message"), Message);
		if (Data.IsValid())
		{
			Err->SetObjectField(TEXT("data"), Data);
		}

		TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
		Obj->SetStringField(TEXT("jsonrpc"), TEXT("2.0"));
		Obj->SetNumberField(TEXT("id"), Id);
		Obj->SetObjectField(TEXT("error"), Err);
		return Obj;
	}

	/** 0.x: require exact major and minor. 1.x+: require major only. */
	static bool CheckProtocolCompat(const FString& ClientVersion)
	{
		TArray<FString> Parts;
		ClientVersion.ParseIntoArray(Parts, TEXT("."));
		if (Parts.Num() < 2)
		{
			return false;
		}
		const int32 ClientMajor = FCString::Atoi(*Parts[0]);
		const int32 ClientMinor = FCString::Atoi(*Parts[1]);
		const int32 ServerMajor = UEMCP_PROTOCOL_VERSION_MAJOR;
		const int32 ServerMinor = UEMCP_PROTOCOL_VERSION_MINOR;
		if (ClientMajor != ServerMajor)
		{
			return false;
		}
		if (ServerMajor == 0 && ClientMinor != ServerMinor)
		{
			return false;
		}
		return true;
	}

	static FString PythonLogTypeToString(EPythonLogOutputType Type)
	{
		switch (Type)
		{
		case EPythonLogOutputType::Info: return TEXT("Info");
		case EPythonLogOutputType::Warning: return TEXT("Warning");
		case EPythonLogOutputType::Error: return TEXT("Error");
		}
		return TEXT("Info");
	}
}

FUEMCPClientConnection::FUEMCPClientConnection(FSocket* InSocket, const FIPv4Endpoint& InEndpoint,
	const FGuid& InId, FUEMCPServer* InServer)
	: Socket(InSocket)
	, ClientEndpoint(InEndpoint)
	, Id(InId)
	, Server(InServer)
{
}

FUEMCPClientConnection::~FUEMCPClientConnection()
{
	if (Thread)
	{
		bStopRequested = true;
		Thread->WaitForCompletion();
		Thread.Reset();
	}
	if (Socket)
	{
		Socket->Close();
		if (ISocketSubsystem* SocketSubsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM))
		{
			SocketSubsystem->DestroySocket(Socket);
		}
		Socket = nullptr;
	}
}

bool FUEMCPClientConnection::StartThread()
{
	const FString ThreadName = FString::Printf(TEXT("UEMCPClient_%s"),
		*Id.ToString(EGuidFormats::DigitsWithHyphens));
	Thread.Reset(FRunnableThread::Create(this, *ThreadName));
	return Thread.IsValid();
}

void FUEMCPClientConnection::Stop()
{
	bStopRequested = true;
}

void FUEMCPClientConnection::Exit()
{
}

uint32 FUEMCPClientConnection::Run()
{
	if (!Socket)
	{
		return 0;
	}
	Socket->SetNonBlocking(true);

	while (!bStopRequested)
	{
		uint32 PendingBytes = 0;
		if (!Socket->HasPendingData(PendingBytes) || PendingBytes == 0)
		{
			FPlatformProcess::Sleep(0.02f);
			continue;
		}

		TArray<uint8> Chunk;
		Chunk.SetNumUninitialized(static_cast<int32>(PendingBytes));
		int32 BytesRead = 0;
		if (!Socket->Recv(Chunk.GetData(), static_cast<int32>(PendingBytes), BytesRead))
		{
			break;
		}
		if (BytesRead == 0)
		{
			break;
		}
		Chunk.SetNum(BytesRead);
		ReadBuffer.Append(Chunk);

		// Process any complete newline-delimited lines accumulated so far.
		while (true)
		{
			int32 NewlineIdx = INDEX_NONE;
			for (int32 i = 0; i < ReadBuffer.Num(); ++i)
			{
				if (ReadBuffer[i] == '\n')
				{
					NewlineIdx = i;
					break;
				}
			}
			if (NewlineIdx == INDEX_NONE)
			{
				break;
			}
			const FString Line = FString(FUTF8ToTCHAR(reinterpret_cast<const char*>(ReadBuffer.GetData()), NewlineIdx));
			ReadBuffer.RemoveAt(0, NewlineIdx + 1, EAllowShrinking::No);
			ProcessLine(Line);
		}
	}

	UE_LOG(LogUEMCP, Verbose, TEXT("UEMCP client disconnected (id=%s)"),
		*Id.ToString(EGuidFormats::DigitsWithHyphens));

	if (Server)
	{
		Server->MarkConnectionDead(Id);
	}
	return 0;
}

void FUEMCPClientConnection::ProcessLine(const FString& Line)
{
	if (Line.IsEmpty())
	{
		return;
	}

	TSharedPtr<FJsonObject> Msg;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Line);
	if (!FJsonSerializer::Deserialize(Reader, Msg) || !Msg.IsValid())
	{
		WriteJson(UEMCP::MakeJsonRpcError(0, -32700, TEXT("Parse error")));
		return;
	}

	int32 RequestId = 0;
	Msg->TryGetNumberField(TEXT("id"), RequestId);

	FString Method;
	Msg->TryGetStringField(TEXT("method"), Method);

	const TSharedPtr<FJsonObject>* ParamsObj = nullptr;
	TSharedPtr<FJsonObject> Params;
	if (Msg->TryGetObjectField(TEXT("params"), ParamsObj) && ParamsObj)
	{
		Params = *ParamsObj;
	}

	if (Method.IsEmpty())
	{
		WriteJson(UEMCP::MakeJsonRpcError(RequestId, -32600, TEXT("Invalid request: missing method")));
		return;
	}

	if (!bHandshakeComplete && Method != TEXT("mcp.handshake"))
	{
		WriteJson(UEMCP::MakeJsonRpcError(RequestId, -32600, TEXT("Handshake required before other methods")));
		return;
	}

	TSharedRef<FJsonObject> Response = UEMCP::MakeJsonRpcError(RequestId, -32601,
		FString::Printf(TEXT("Method not found: %s"), *Method));

	if (Method == TEXT("mcp.handshake"))
	{
		Response = HandleHandshake(RequestId, Params);
	}
	else if (Method == TEXT("mcp.list_tools"))
	{
		Response = HandleListTools(RequestId);
	}
	else if (Method == TEXT("mcp.call_tool"))
	{
		Response = HandleCallTool(RequestId, Params);
	}

	WriteJson(Response);
}

TSharedRef<FJsonObject> FUEMCPClientConnection::HandleHandshake(int32 RequestId, const TSharedPtr<FJsonObject>& Params)
{
	FString ClientVersion;
	if (!Params.IsValid() || !Params->TryGetStringField(TEXT("protocol_version"), ClientVersion))
	{
		return UEMCP::MakeJsonRpcError(RequestId, -32602, TEXT("handshake requires 'protocol_version'"));
	}

	if (!UEMCP::CheckProtocolCompat(ClientVersion))
	{
		return UEMCP::MakeJsonRpcError(RequestId, -32000, FString::Printf(
			TEXT("protocol version mismatch: client=%s server=%s"),
			*ClientVersion, UEMCP_PROTOCOL_VERSION_STRING));
	}

	bHandshakeComplete = true;
	SessionId = FGuid::NewGuid();

	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("protocol_version"), UEMCP_PROTOCOL_VERSION_STRING);
	Result->SetStringField(TEXT("server"), TEXT("UEMCP"));
	Result->SetStringField(TEXT("server_version"), UEMCP_PLUGIN_VERSION);
	Result->SetStringField(TEXT("session_id"), SessionId.ToString(EGuidFormats::DigitsWithHyphens));
	return UEMCP::MakeJsonRpcResult(RequestId, Result);
}

TSharedRef<FJsonObject> FUEMCPClientConnection::HandleListTools(int32 RequestId)
{
	// execute_python input schema: { code: string }  required: [code]
	TSharedRef<FJsonObject> CodeProp = MakeShared<FJsonObject>();
	CodeProp->SetStringField(TEXT("type"), TEXT("string"));
	CodeProp->SetStringField(TEXT("description"), TEXT("Python source to execute. Multi-line supported."));

	TSharedRef<FJsonObject> Properties = MakeShared<FJsonObject>();
	Properties->SetObjectField(TEXT("code"), CodeProp);

	TSharedRef<FJsonObject> InputSchema = MakeShared<FJsonObject>();
	InputSchema->SetStringField(TEXT("type"), TEXT("object"));
	InputSchema->SetObjectField(TEXT("properties"), Properties);

	TArray<TSharedPtr<FJsonValue>> Required;
	Required.Add(MakeShared<FJsonValueString>(TEXT("code")));
	InputSchema->SetArrayField(TEXT("required"), Required);

	TSharedRef<FJsonObject> Tool = MakeShared<FJsonObject>();
	Tool->SetStringField(TEXT("name"), TEXT("execute_python"));
	Tool->SetStringField(TEXT("description"),
		TEXT("Execute Python code inside this Unreal Editor. Has access to the `unreal` module and all loaded Python libraries (including any project-local scripting libraries)."));
	Tool->SetObjectField(TEXT("input_schema"), InputSchema);

	TArray<TSharedPtr<FJsonValue>> Tools;
	Tools.Add(MakeShared<FJsonValueObject>(Tool));

	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetArrayField(TEXT("tools"), Tools);
	return UEMCP::MakeJsonRpcResult(RequestId, Result);
}

TSharedRef<FJsonObject> FUEMCPClientConnection::HandleCallTool(int32 RequestId, const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return UEMCP::MakeJsonRpcError(RequestId, -32602, TEXT("call_tool requires params"));
	}

	FString ToolName;
	Params->TryGetStringField(TEXT("name"), ToolName);

	const TSharedPtr<FJsonObject>* ArgsObj = nullptr;
	TSharedPtr<FJsonObject> Args;
	if (Params->TryGetObjectField(TEXT("arguments"), ArgsObj) && ArgsObj)
	{
		Args = *ArgsObj;
	}

	if (ToolName == TEXT("execute_python"))
	{
		return ExecutePythonTool(RequestId, Args);
	}

	return UEMCP::MakeJsonRpcError(RequestId, -32001, FString::Printf(TEXT("Tool not found: %s"), *ToolName));
}

TSharedRef<FJsonObject> FUEMCPClientConnection::ExecutePythonTool(int32 RequestId, const TSharedPtr<FJsonObject>& Args)
{
	if (!Args.IsValid())
	{
		return UEMCP::MakeJsonRpcError(RequestId, -32602, TEXT("execute_python requires 'arguments'"));
	}
	FString Code;
	if (!Args->TryGetStringField(TEXT("code"), Code))
	{
		return UEMCP::MakeJsonRpcError(RequestId, -32602, TEXT("execute_python requires 'code' string argument"));
	}

	const float TimeoutSecs = GetDefault<UUEMCPSettings>()->ExecutePythonTimeoutSeconds;

	TPromise<TSharedPtr<FJsonObject>> Promise;
	TFuture<TSharedPtr<FJsonObject>> Future = Promise.GetFuture();

	// Move Promise into the lambda; game thread fulfills it.
	AsyncTask(ENamedThreads::GameThread,
		[CapturedCode = Code, CapturedPromise = MoveTemp(Promise)]() mutable
		{
			TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();

			IPythonScriptPlugin* PyPlugin = IPythonScriptPlugin::Get();
			if (!PyPlugin)
			{
				Result->SetBoolField(TEXT("success"), false);
				Result->SetStringField(TEXT("command_result"), TEXT(""));
				Result->SetArrayField(TEXT("log_output"), TArray<TSharedPtr<FJsonValue>>());
				Result->SetStringField(TEXT("error"), TEXT("PythonScriptPlugin is not available"));
				CapturedPromise.SetValue(Result);
				return;
			}

			FPythonCommandEx Cmd;
			Cmd.Command = CapturedCode;
			Cmd.ExecutionMode = EPythonCommandExecutionMode::ExecuteFile;
			const bool bOk = PyPlugin->ExecPythonCommandEx(Cmd);

			TArray<TSharedPtr<FJsonValue>> LogArr;
			for (const FPythonLogOutputEntry& Entry : Cmd.LogOutput)
			{
				TSharedRef<FJsonObject> L = MakeShared<FJsonObject>();
				L->SetStringField(TEXT("type"), UEMCP::PythonLogTypeToString(Entry.Type));
				L->SetStringField(TEXT("output"), Entry.Output);
				LogArr.Add(MakeShared<FJsonValueObject>(L));
			}

			Result->SetBoolField(TEXT("success"), bOk);
			Result->SetStringField(TEXT("command_result"), Cmd.CommandResult);
			Result->SetArrayField(TEXT("log_output"), LogArr);
			CapturedPromise.SetValue(Result);
		});

	if (Future.WaitFor(FTimespan::FromSeconds(TimeoutSecs)))
	{
		const TSharedPtr<FJsonObject> FutureResult = Future.Get();
		if (FutureResult.IsValid())
		{
			return UEMCP::MakeJsonRpcResult(RequestId, FutureResult.ToSharedRef());
		}
		return UEMCP::MakeJsonRpcError(RequestId, -32603, TEXT("internal: null result from game thread"));
	}

	// Timeout: the game-thread task still owns the Promise via shared state and
	// will complete without crashing, but its result is discarded.
	return UEMCP::MakeJsonRpcError(RequestId, -32003,
		FString::Printf(TEXT("execute_python timed out after %.1fs"), TimeoutSecs));
}

bool FUEMCPClientConnection::WriteJson(const TSharedRef<FJsonObject>& Obj)
{
	FString Output;
	const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
		TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Output);
	if (!FJsonSerializer::Serialize(Obj, Writer))
	{
		return false;
	}
	return WriteRaw(Output + TEXT("\n"));
}

bool FUEMCPClientConnection::WriteRaw(const FString& LineWithNewline)
{
	if (!Socket)
	{
		return false;
	}
	const FTCHARToUTF8 Converter(*LineWithNewline);
	const uint8* const Data = reinterpret_cast<const uint8*>(Converter.Get());
	const int32 TotalSize = Converter.Length();

	FScopeLock Lock(&WriteMutex);
	int32 TotalSent = 0;
	while (TotalSent < TotalSize)
	{
		int32 Sent = 0;
		if (!Socket->Send(Data + TotalSent, TotalSize - TotalSent, Sent))
		{
			return false;
		}
		if (Sent <= 0)
		{
			return false;
		}
		TotalSent += Sent;
	}
	return true;
}
