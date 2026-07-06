<template>
  <c-card
    ref="folderContainer"
    class="add-folder"
    data-testid="create-folder-modal"
    @keydown="handleKeyDown"
  >
    <div
      id="folder-modal-content"
      class="modal-content-wrapper"
    >
      <c-toasts
        id="folder-toasts"
        data-testid="folder-toasts"
        vertical="bottom"
        absolute
      />
      <h2 class="title is-4">
        {{ $t("message.objects.createFolder") }}
      </h2>

      <c-card-content>
        <p class="info-text is-size-6">
          {{ $t("message.container_ops.foldername") }}
        </p>

        <c-text-field
          id="newFolder-input"
          v-model="folderName"
          v-csc-control
          :label="$t('message.objects.folderName')"
          name="foldername"
          aria-required="true"
          data-testid="folder-name"
          :valid="errorMsg.length === 0"
          :validation="errorMsg"
          required
          validate-on-blur
          @changeValue="interacted = true"
        />
      </c-card-content>
    </div>

    <c-card-actions justify="space-between">
      <c-button
        outlined
        size="large"
        data-testid="cancel-save-folder"
        @click="close(false)"
        @keyup.enter="close(true)"
      >
        {{ $t("message.cancel") }}
      </c-button>

      <c-button
        size="large"
        data-testid="save-folder"
        @click="create(false)"
        @keyup.enter="create(true)"
      >
        {{ $t("message.save") }}
      </c-button>
    </c-card-actions>
  </c-card>
</template>

<script>
import { toRaw } from "vue";
import { awsPutObject } from "@/common/s3commands";
import {
  getFocusableElements,
  moveFocusOutOfModal,
  keyboardNavigationInsideModal,
} from "@/common/keyboardNavigation";

export default {
  name: "FolderModal",
  data() {
    return {
      folderName: "",
      interacted: false,
      errorMsg: "",
    };
  },
  computed: {
    prevActiveEl() {
      return this.$store.prevActiveEl;
    },
    container() {
      return this.$route.params.container;
    },
    currentPrefix() {
      const raw = (this.$route.query.prefix || "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      return raw ? `${raw}/` : "";
    },
  },
  watch: {
    folderName() {
      if (!this.interacted) {
        this.errorMsg = "";
        return;
      }
      this.errorMsg = this.validateName(this.folderName);
    },
  },
  methods: {
    async create(keypress) {
      this.folderName = (this.folderName || "").trim();
      this.errorMsg = this.validateName(this.folderName);
      if (this.errorMsg) return;

      const name = toRaw(this.folderName)
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const objectName = `${this.currentPrefix}${name}/`;

      try {
        await awsPutObject(this.container, objectName);
        this.close(keypress);
      } catch {
        document.querySelector("#folder-toasts")?.addToast({
          id: "create-folder-toast",
          progress: false,
          type: "error",
          message: this.$t("message.container_ops.folderCreateFail"),
        });
      }
    },

    close(keypress) {
      this.$store.toggleCreateBucketModal(false);
      this.folderName = "";
      this.interacted = false;
      this.errorMsg = "";
      document.querySelector("#folder-toasts")?.removeToast("create-folder-toast");
      if (keypress) moveFocusOutOfModal(this.prevActiveEl);
    },

    validateName(name) {
      const n = (name || "").trim();
      if (!n) return this.$t("message.error.invalidName");
      if (n.includes("//")) return this.$t("message.error.invalidName");
      if (/[\\]/.test(n)) return this.$t("message.error.invalidName");
      return "";
    },

    handleKeyDown(e) {
      const focusableList = this.$refs.folderContainer
        .querySelectorAll("input, c-link, c-button");
      const { first, last } = getFocusableElements(focusableList);
      keyboardNavigationInsideModal(e, first, last);
    },
  },
};
</script>

<style scoped>
.add-folder {
  padding: 3rem;
  position: absolute;
  top: -1rem;
  left: 0;
  right: 0;
  max-height: 75vh;
}

c-card-content {
  color: var(--csc-dark);
  padding: 1.5rem 0 0 0;
}

c-card-actions {
  padding: 0;
}

c-card-actions > c-button {
  margin: 0;
}
</style>
