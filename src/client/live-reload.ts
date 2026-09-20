/** Reloads the page when the dev server reports a file change. */
export function startLiveReload(): void {
  const events = new EventSource("/events");
  events.onmessage = () => location.reload();
}
