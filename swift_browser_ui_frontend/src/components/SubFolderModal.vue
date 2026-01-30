<template>
  <c-card
    ref="subFolderContainer"
    class="add-folder"
    data-testid="create-subfolder-modal"
    @keydown="handleKeyDown"
  >
    <div id="subFolder-modal-content" class="modal-content-wrapper">
      <c-toasts id="subFolder-toasts" data-testid="subFolder-toasts" vertical="bottom" absolute />
      <h2 class="title is-4">
        {{ $t('message.objects.createFolder') || 'Create folder' }}
      </h2>

      <c-card-content>
        <p class="info-text is-size-6">
          {{ $t('message.container_ops.subfoldername') }}
        </p>

        <c-text-field
          id="newFolder-input"
          v-model="folderName"
          v-csc-control
          :label="$t('message.objects.folderName') || $t('message.container_ops.folderName')"
          name="subfoldername"
          aria-required="true"
          data-testid="subfolder-name"
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
        data-testid="cancel-save-subfolder"
        @click="close(false)"
        @keyup.enter="close(true)"
      >
        {{ $t('message.cancel') }}
      </c-button>

      <c-button
        size="large"
        data-testid="save-subfolder"
        @click="create(false)"
        @keyup.enter="create(true)"
      >
        {{ $t('message.save') }}
      </c-button>
    </c-card-actions>
  </c-card>
</template>

<script>
import { swiftCreateEmptyObject } from "@/common/api";
import { getDB } from "@/common/db";
import { toRaw } from "vue";
import {
  getFocusableElements,
  moveFocusOutOfModal,
  keyboardNavigationInsideModal,
} from "@/common/keyboardNavigation";

export default {
  name: "SubFolderModal",
  data() {
    return {
      folderName: "",
      interacted: false,
      errorMsg: "",
    };
  },
  computed: {
    prevActiveEl() { return this.$store.state.prevActiveEl; },
    modalVisible() { return this.$store.state.openCreateFolderModal; },

    projectId()   { return this.$route.params.project; },
    container()   { return this.$route.params.container; },
    ownerParam()  { return this.$route.params.owner; },
    currentPrefix() {
      const raw = (this.$route.query.prefix || "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      return raw ? `${raw}/` : "";
    },
  },
  watch: {
    folderName() {
      if (!this.interacted) { this.errorMsg = ""; return; }
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
        await swiftCreateEmptyObject(
          this.projectId,
          this.container,
          objectName,
          this.ownerParam,
        );

        // refresh the object list so the folder appears
        const cont = await getDB().containers.get({
          projectID: this.projectId,
          name: this.container,
        });
        if (cont) {
          await this.$store.dispatch("updateObjects", {
            projectID: this.projectId,
            container: cont,
            ...(this.ownerParam ? { owner: this.ownerParam } : {}),
          });
        }

        this.close(keypress);
      } catch (err) {
        document.querySelector("#subFolder-toasts")?.addToast({
          id: "create-subfolder-toast",
          progress: false,
          type: "error",
          message: this.$t("message.container_ops.createFail") || "Failed to create folder.",
        });
      }
    },

    close(keypress) {
      this.$store.commit("toggleCreateFolderModal", false);
      this.folderName = "";
      this.interacted = false;
      this.errorMsg = "";
      document.querySelector("#subFolder-toasts")?.removeToast("create-subfolder-toast");
      if (keypress) moveFocusOutOfModal(this.prevActiveEl);
    },

    validateName(name) {
      const n = (name || "").trim();
      if (!n) return this.$t("message.error.invalidName") || "Name is required.";
      if (n.includes("//")) return this.$t("message.error.invalidName") || "Invalid name.";
      if (/[\\]/.test(n)) return this.$t("message.error.invalidName") || "Invalid character.";
      return "";
    },

    handleKeyDown(e) {
      const focusableList = this.$refs.subFolderContainer
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

@media screen and (max-width: 767px), (max-height: 580px) {
  .add-folder { top: -5rem; }
}
@media screen and (max-height: 580px) and (max-width: 767px),
(max-width: 525px) {
  .add-folder { top: -9rem; }
}
@media screen and (max-height: 580px) and (max-width: 525px) {
  .add-folder { top: -13rem; }
}

c-card-content { color: var(--csc-dark); padding: 1.5rem 0 0 0; }
c-card-actions { padding: 0; }
c-card-actions > c-button { margin: 0; }
</style>
