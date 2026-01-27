<template>
  <div class="app-layout">
    <CatWrapper>
      <div class="app">
        <h1>HTML Localizer</h1>

        <ZipUploadStep :zip-name="zipName" @select="setZipFile" />

        <ProcessStep :disabled="!canProcess || loading" :loading="loading" :entries="entries" @process="processArchive"
          @clear="clear" />


      </div>
    </CatWrapper>
  </div>
</template>

<script setup>
import CatWrapper from "@/components/CatWrapper.vue";
import ZipUploadStep from "@/components/html-localizer/ZipUploadStep.vue";
import ProcessStep from "@/components/html-localizer/ProcessStep.vue";
import { useHtmlLocalizer } from "@/composables/useHtmlLocalizer";

const {
  zipName,
  loading,
  canProcess,
  entries,
  clear,
  setZipFile,
  processArchive,
} = useHtmlLocalizer();
</script>
<style scoped>
.app-layout {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px;
  overflow-wrap: anywhere;
}

.app {
  --hl-surface: #ffffff;
  --hl-surface-2: #f8fafc;
  --hl-border: rgba(15, 23, 42, 0.12);
  --hl-text: #0f172a;
  --hl-muted: #475569;

  --hl-primary: #2563eb;
  --hl-primary-hover: #1d4ed8;
  --hl-primary-pressed: #1e40af;
  --hl-focus: rgba(37, 99, 235, 0.35);

  --hl-success: #047857;
  --hl-warn: #b45309;
  --hl-danger: #b91c1c;

  --hl-radius: 16px;
  --hl-radius-sm: 12px;

  --hl-shadow: 0 18px 50px rgba(2, 6, 23, 0.08);
  --hl-shadow-sm: 0 10px 24px rgba(2, 6, 23, 0.06);

  width: auto;
  margin: 0;
  padding: 28px 32px 28px;

  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--hl-text);
  background: var(--hl-surface);
  border: 1px solid var(--hl-border);
  border-radius: calc(var(--hl-radius) + 6px);
  box-shadow: var(--hl-shadow);
}

h1 {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--hl-text);
}

h1::after {
  content: "";
  display: block;
  margin-top: 10px;
  height: 1px;
  background: rgba(15, 23, 42, 0.08);
}
</style>

