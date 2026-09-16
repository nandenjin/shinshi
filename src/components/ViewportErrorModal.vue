<script setup lang="ts">
import { moldStore } from "../composables/useMoldStore.ts";
</script>

<template>
  <div v-if="moldStore.loadError" class="modal-scrim">
    <div class="modal-card">
      <h2>モデルを修正してください</h2>
      <p>
        このモデルは閉じた立体（多様体）になっていません。壁に穴や重なりがあるため、このままでは型のシェルを生成できません。
      </p>
      <p>
        メッシュ修復ツール（<a
          href="https://www.blender.org/"
          target="_blank"
          rel="noopener noreferrer"
          >Blender</a
        >や
        <a
          href="https://meshmixer.org/"
          target="_blank"
          rel="noopener noreferrer"
          >Meshmixer</a
        >、<a
          href="https://www.netfabb.com/"
          target="_blank"
          rel="noopener noreferrer"
          >Netfabb</a
        >
        など）でモデルを修復してから、再度読み込んでください。
      </p>
      <p class="detail">
        {{ moldStore.loadError.status }}: {{ moldStore.loadError.message }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.modal-scrim {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
}

.modal-card {
  background: color-mix(in srgb, var(--color-pane-bg) 92%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 20px 24px;
  max-width: 420px;
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

h2 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}

p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--color-text);
}

.detail {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--color-label);
}
</style>
