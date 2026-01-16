<template>
  <c-card
    ref="infoContainer"
    class="info-card"
    data-testid="object-info-modal"
    @keydown="handleKeyDown"
  >
    <div id="object-info-modal-content" class="modal-content-wrapper">
     <h2 class="title is-4">
        {{ $t("message.objects.info") || "Info" }}<span v-if="info?.name"> – {{ info.name }}</span>
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


          <p><b>{{ $t("message.objects.created") || "Created" }}:</b> {{ info.created || "-" }}</p>
          <p><b>{{ $t("message.table.modified") || "Last modified" }}:</b> {{ info.lastModified || "-" }}</p>

          <p><b>ETag:</b> {{ info.etag || "-" }}</p>
          <p><b>{{ $t("message.objects.checksum") || "Checksum" }}:</b> {{ info.checksum || "-" }}</p>


          <p v-if="info.meta && Object.keys(info.meta).length">
            <b>{{ $t("message.objects.metadata") || "Metadata" }}:</b>
          </p>
          <ul v-if="info.meta && Object.keys(info.meta).length">
            <li v-for="(v, k) in info.meta" :key="k">
              <code>{{ k }}</code>: {{ v }}
            </li>
          </ul>
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
  methods: {
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
</style>
