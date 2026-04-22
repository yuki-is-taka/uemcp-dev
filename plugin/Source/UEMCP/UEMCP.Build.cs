// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.

using UnrealBuildTool;

public class UEMCP : ModuleRules
{
	public UEMCP(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"CoreUObject",
			"Engine",
			"UnrealEd",
			"Sockets",
			"Networking",
			"Json",
			"JsonUtilities",
			"DeveloperSettings",
			"Projects",
			"PythonScriptPlugin",
		});
	}
}
