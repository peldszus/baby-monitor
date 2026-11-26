export type RemoteEndRole = 'child' | 'parent'

export function formatRemoteEndNotice(role: RemoteEndRole, at: Date): string {
  const time = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at)
  return `The ${role} device ended the stream at ${time}.`
}
