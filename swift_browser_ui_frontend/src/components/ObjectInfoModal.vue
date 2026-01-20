<template>
  <c-card
    ref="infoContainer"
    class="info-card"
    data-testid="object-info-modal"
    @keydown="handleKeyDown"
  >
    <div id="object-info-modal-content" class="modal-content-wrapper">
     <h2 class="title is-4 title-row" v-if="info">
       <c-link
         href="javascript:void(0)"
         color="dark-grey"
         :path="info.isFolder ? mdiFolder : mdiFileOutline"
         iconFill="primary"
         class="title-icon-link"
       />
       {{ info.name }}
     </h2>

      <c-card-content>
        <div v-if="info">
          <p><b>{{ $t("message.table.name") || "Name" }}:</b> {{ info.name }}</p>
          <p><b>{{ $t("message.table.size") || "Size" }}:</b> {{ info.sizeHuman || "-" }}</p>
           <p v-if="info.isFolder">
            <b>{{ $t("message.objects.items") || "Items" }}:</b> {{ info.itemCount }}
          </p>
          <p><b>{{ $t("message.objects.fullPath") || "Full path" }}:</b> {{ info.fullPath || "-" }}</p>
          <p><b>{{ $t("message.objects.contentType") || "Content-Type" }}:</b> {{ info.contentType || "-" }}</p>
          <p v-if="info.etag" class="inline-copy">
            <b>ETag:</b>
            <span class="inline-copy-value">{{ info.etag }}</span>
            <c-button
              ghost
              class="copy-icon-btn"
              title="Copy ETag"
              :aria-label="'Copy ETag'"
              @click="copyToClipboard(info.etag)"
              @keyup.enter="copyToClipboard(info.etag)"
            >
              <c-icon slot="icon" :path="mdiContentCopy" />
            </c-button>
          </p>
          <p><b>{{ $t("message.table.modified") || "Last modified" }}:</b> {{ info.lastModified || "-" }}</p>
          <p v-if="info && !info.isFolder">
            <b>{{ $t("message.objects.created") || "Created" }}:</b> {{ info.created || "-" }}
          </p>
          <p v-if="!info.isFolder" class="inline-copy">
            <b>{{ $t("message.objects.checksum") || "Checksum" }} (SHA-256):</b>
            <span class="inline-copy-value">{{ info.checksum || "-" }}</span>
              <c-button
                v-if="info.checksum && info.checksum !== '-'"
                ghost
                class="copy-icon-btn"
                title="Copy checksum"
                aria-label="Copy checksum"
                @click="copyToClipboard(info.checksum)"
                @keyup.enter="copyToClipboard(info.checksum)"
              >
                <c-icon slot="icon" :path="mdiContentCopy" />
              </c-button>
          </p>
          <p class="info-note" v-if="info && !info.isFolder">
            {{ $t("message.objects.createdChecksumNote")}}
          </p>
        </div>

        <div v-else>
          {{ $t("message.objects.noInfo") || "No info available." }}
        </div>
      </c-card-content>
    </div>

    <c-card-actions justify="end">
      <c-button outlined size="large" @click="close" @keyup.enter="close">
        {{ $t("message.close") || "Close" }}
      </c-button>
    </c-card-actions>
  </c-card>
</template>

<script>
import {
  getFocusableElements,
  keyboardNavigationInsideModal,
  moveFocusOutOfModal,
} from "@/common/keyboardNavigation";
import { mdiFolder, mdiFileOutline, mdiContentCopy } from "@mdi/js";


export default {
  name: "ObjectInfoModal",
  computed: {
    info() {
      return this.$store.state.selectedObjectInfo;
    },
    prevActiveEl() {
      return this.$store.state.prevActiveEl;
    },
  },
  data() {
    return {
      mdiFolder,
      mdiFileOutline,
      mdiContentCopy,
    };
  },
  methods: {
    async copyToClipboard(value) {
      if (!value || value === "-") return;

      try {
        await navigator.clipboard.writeText(value);
      } catch (e) {
        const el = document.createElement("textarea");
        el.value = value;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    },
    close() {
      this.$store.commit("toggleObjectInfoModal", false);
      this.$store.commit("setSelectedObjectInfo", null);
      moveFocusOutOfModal(this.prevActiveEl);
    },
    handleKeyDown(e) {
      const focusableList = this.$refs.infoContainer.querySelectorAll(
        "c-link, c-button, textarea, c-text-field, c-data-table",
      );
      const { first, last } = getFocusableElements(focusableList);
      keyboardNavigationInsideModal(e, first, last, true);
    },
  },
};
</script>

<style scoped lang="scss">
.info-card {
  padding: 3rem;
  position: absolute;
  top: -1rem;
  left: 0;
  right: 0;
  max-height: 75vh;
}
c-card-content {
  padding: 1rem 0 0 0;
  color: var(--csc-dark);
}
ul {
  margin-top: .5rem;
  padding-left: 1.2rem;
}
.info-note {
  margin-top: 1.5rem;
  font-size: 0.9rem;
  font-style: italic;
  opacity: 0.75;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.title-icon-link {
  pointer-events: none;
  display: inline-flex;
  margin-right: 0.25rem;
  opacity: 0.7;
}
.title-icon-link {
  line-height: 1;
}
.inline-copy {
  display: flex;
  gap: 0.4rem;
  margin-bottom: -25px;
}
.inline-copy-value {
  word-break: break-all;
}
.copy-icon-btn {
  transform: scale(0.65);
  margin-left: 0.2rem;
  position: relative;
  top: -12px;
}
.copy-icon-btn:hover {
  opacity: 1;
}
</style>
