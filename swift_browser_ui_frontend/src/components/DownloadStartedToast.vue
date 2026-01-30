<template>
  <c-toasts id="download-start-toasts">
    <div class="toast-wrapper">
      <c-row justify="space-between" align="center">
        <h3>{{ $t("message.download.startedInBrowser") }}</h3>

        <c-icon-button
          size="small"
          text
          @click="close"
          @keyup.enter="close"
        >
          <c-icon :path="mdiClose" />
        </c-icon-button>
      </c-row>

      <c-button
        outlined
        size="small"
        @click="close"
        @keyup.enter="close"
      >
        {{ $t("message.share.close") }}
      </c-button>
    </div>
  </c-toasts>
</template>

<script>
import { mdiClose } from "@mdi/js";

export default {
  name: "DownloadStartedToast",
  data() {
    return { mdiClose };
  },
  mounted() {
    setTimeout(() => {
      document.querySelector("#download-start-toasts")?.addToast({
        id: "download-started-toast",
        type: "success",
        custom: true,
        persistent: true,      // let Vue control hide timing
        horizontal: "center",
      });
    }, 0);
  },
  methods: {
    close() {
      document
        .querySelector("#download-start-toasts")
        ?.removeToast("#download-started-toast");
      this.$store.commit("toggleDownloadStartedToast", false);
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
