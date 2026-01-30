<template>
  <c-toasts id="preview-open-toasts">
    <div class="toast-wrapper">
      <c-row justify="space-between" align="center">
        <h3>{{ $t("message.preview.openedInNewTab") }}</h3>
      </c-row>

      <c-button outlined size="small" @click="close" @keyup.enter="close">
        {{ $t("message.share.close") }}
      </c-button>
    </div>
  </c-toasts>
</template>

<script>
import { mdiClose } from "@mdi/js";

export default {
  name: "PreviewOpenedToast",
  data() {
    return { mdiClose };
  },
  mounted() {
    setTimeout(() => {
      document.querySelector("#preview-open-toasts")?.addToast({
        id: "preview-opened-toast",
        type: "success",
        custom: true,
        persistent: true,
        horizontal: "center",
      });
    }, 0);
  },
  methods: {
    close() {
      document
        .querySelector("#preview-open-toasts")
        ?.removeToast("#preview-opened-toast");
      this.$store.commit("togglePreviewOpenedToast", false);
    },
  },
};
</script>

<style scoped>
.toast-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  color: var(--csc-dark);
}
h3 {
  font-size: 20px;
  margin: 0;
}
</style>
