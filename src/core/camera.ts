export interface CameraDevice {
  deviceId: string
  label: string
  wide: boolean
}

const WIDE_PATTERN = /(wide|ultra|fisheye|0\.5)/i
const REAR_PATTERN = /\b(back|rear|environment)\b/i

export function isWideCameraLabel(label: string): boolean {
  return WIDE_PATTERN.test(label)
}

export function isRearCameraLabel(label: string): boolean {
  return REAR_PATTERN.test(label)
}

export function preferNormalCamera(devices: CameraDevice[], currentId?: string): string {
  if (devices.length === 0) return ''
  const current = devices.find((device) => device.deviceId === currentId)
  const rear = devices.filter((device) => isRearCameraLabel(device.label))
  if (rear.length > 0) {
    return (rear.find((device) => !device.wide) ?? current ?? rear[0]).deviceId
  }
  return current?.deviceId ?? ''
}

export async function listVideoInputs(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  let index = 0
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => {
      index += 1
      return {
        deviceId: device.deviceId,
        label: device.label.trim() || `Camera ${index}`,
        wide: isWideCameraLabel(device.label),
      }
    })
}
