import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'baby-monitor:install-dismissed'

function isStandaloneDisplay(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function useInstallPrompt() {
  const promptEvent = ref<InstallPromptEvent | null>(null)
  const installed = ref(false)
  const dismissed = ref(false)
  const standalone = ref(false)

  const canInstall = computed(
    () => promptEvent.value !== null && !installed.value && !dismissed.value
  )
  const isIos = computed(() => !standalone.value && /iphone|ipad|ipod/i.test(navigator.userAgent))

  function updateStandalone(): void {
    standalone.value = isStandaloneDisplay()
    if (standalone.value) installed.value = true
  }

  function onBeforeInstallPrompt(event: Event): void {
    event.preventDefault()
    promptEvent.value = event as InstallPromptEvent
  }

  function onInstalled(): void {
    installed.value = true
    promptEvent.value = null
  }

  async function install(): Promise<boolean> {
    const event = promptEvent.value
    if (!event) return false
    try {
      await event.prompt()
      const choice = await event.userChoice
      promptEvent.value = null
      if (choice.outcome === 'accepted') {
        installed.value = true
        return true
      }
      return false
    } catch {
      promptEvent.value = null
      return false
    }
  }

  function dismiss(): void {
    dismissed.value = true
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Storage can be unavailable in private modes; dismissal still applies for this visit.
    }
  }

  onMounted(() => {
    try {
      dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      dismissed.value = false
    }
    updateStandalone()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  })

  return { canInstall, installed, standalone, isIos, install, dismiss }
}
