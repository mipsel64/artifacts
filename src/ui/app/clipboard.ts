// Call it in the click handler with nothing awaited before it: Safari drops the user activation at the first await.
export async function copyLater(load: () => Promise<string>): Promise<boolean> {
  try {
    const blob = load().then((text) => new Blob([text], { type: 'text/plain' }));
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    return true;
  } catch {
    return false;
  }
}
