export interface ChildMediaOptions {
  videoDeviceId?: string
  audioDeviceId?: string
}

export async function openChildMedia(options: ChildMediaOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera and microphone access is not available in this browser.')
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: options.audioDeviceId ? { exact: options.audioDeviceId } : undefined,
    },
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15, max: 30 },
      deviceId: options.videoDeviceId ? { exact: options.videoDeviceId } : undefined,
    },
  })
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}
