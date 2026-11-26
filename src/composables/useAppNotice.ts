import { readonly, ref } from 'vue'

const notice = ref<string | null>(null)

export function showNotice(message: string): void {
  notice.value = message
}

export function dismissNotice(): void {
  notice.value = null
}

export function useAppNotice() {
  return {
    notice: readonly(notice),
    showNotice,
    dismissNotice,
  }
}
