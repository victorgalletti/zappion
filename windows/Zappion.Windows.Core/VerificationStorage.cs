// SPDX-License-Identifier: AGPL-3.0-only
namespace Zappion.Windows.Core;

// Verification always opts in to a file beneath windows/.verification, never the owner's session.
public static class VerificationStorage
{
    public static string? DirectoryPath => Validate(Environment.GetEnvironmentVariable("ZAPPION_VERIFICATION_DIRECTORY"));
    public static string? Validate(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory)) return null;
        var full = Path.GetFullPath(directory);
        var current = new DirectoryInfo(full);
        while (current.Parent is not null)
        {
            if (current.Name == ".verification" && current.Parent.Name == "windows") return full;
            current = current.Parent;
        }
        throw new InvalidOperationException("Verification storage must be beneath windows/.verification.");
    }
    public static string? FilePath(string name) => DirectoryPath is { } directory ? Path.Combine(directory, name) : null;
}
