// SPDX-License-Identifier: AGPL-3.0-only
using Microsoft.UI.Xaml.Markup;
using Zappion.Windows.Core;
namespace Zappion.Windows;
[MarkupExtensionReturnType(ReturnType = typeof(string))]
public sealed class TextExtension : MarkupExtension
{
    public string Key { get; set; } = "";
    protected override object ProvideValue() => UiStrings.Get(Key);
}
