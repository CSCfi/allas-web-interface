<template>
  <c-card
    ref="shareContainer"
    class="modal-card"
    @keydown="handleKeyDown"
  >
    <c-card-actions
      justify="space-between"
    >
      <h2 class="title is-4">
        {{ $t('message.share.share_title') }}
        {{ bucketName }}
      </h2>
      <c-button
        id="close-share-modal-btn"
        data-testid="close-share-modal"
        text
        @click="toggleShareModal"
        @keyup.enter="toggleShareModal"
      >
        <c-icon
          :path="mdiClose"
          alt=""
          aria-hidden="true"
        />
        {{ $t("message.share.close") }}
      </c-button>
    </c-card-actions>
    <c-card-content
      id="share-card-modal-content"
      class="modal-content-wrapper"
    >
      <div class="container">
        <div class="flex toggle-instructions">
          <c-link
            underline
            tabindex="0"
            :aria-label="$t('label.shareid_instructions')"
            @click="toggleShareGuide"
            @keyup.enter="toggleShareGuide"
          >
            <c-icon :path="mdiInformationOutline" size="16" />
            {{ openShareGuide ? $t("message.share.close_instructions")
              : $t("message.share.instructions")
            }}
          </c-link>
        </div>
        <div
          v-show="openShareGuide"
          class="content guide-content"
        >
          <p>
            {{ $t("message.share.share_guide_intro") }}
          </p>
          <p>
            <i18n-t
              keypath="message.share.share_guide_step1b"
              scope="global"
              tag="b"
            />
            <i18n-t
              keypath="message.share.share_guide_step1"
              scope="global"
            />
          </p>
          <i18n-t
            keypath="message.share.share_guide_step2"
            scope="global"
            tag="b"
          />
          <ul>
            <li>
              <b>{{ $t("message.share.read_perm") }}</b>{{
                $t("message.share.read_perm_desc") }}
            </li>
            <li>
              <b>{{ $t("message.share.write_perm") }}</b>{{
                $t("message.share.write_perm_desc") }}
            </li>
          </ul>
        </div>
        <TagInput
          id="share-ids"
          data-testid="share-id-input"
          :tags="tags"
          aria-label="label.list_of_shareids"
          placeholder="message.share.field_placeholder"
          @addTag="addingTag"
          @deleteTag="deletingTag"
        />
        <div id="share-select">
          <c-select
            id="select-share-access"
            v-model="sharedAccessRight"
            v-csc-control
            data-testid="select-permissions"
            :label="$t('message.share.permissions')"
            :placeholder="$t('message.share.permissions')"
            hide-details
            @changeValue="onSelectPermission($event)"
          >
            <c-option
              v-for="(perm, i) in accessRights"
              :key="i+locale"
              :data-testid="perm.value + '-perm'"
              :name="perm.name"
              :value="perm.value"
            >
              <span style="white-space: normal;">
                <b>{{ perm.name }}</b>{{ perm.desc }}
              </span>
            </c-option>
          </c-select>
        </div>
        <c-button
          id="share-btn"
          data-testid="submit-share"
          :loading="loading"
          @click="shareSubmit"
          @keyup.enter="shareSubmit"
        >
          {{ $t('message.share.confirm') }}
        </c-button>
      </div>
      <c-alert
        v-show="isShared || isPermissionRemoved || isPermissionUpdated"
        type="success"
        data-testid="share-success-alert"
      >
        <div class="shared-notification">
          {{ isShared ? $t('message.share.shared_successfully')
            : isPermissionUpdated ? $t('message.share.update_permission')
              : $t('message.share.remove_permission')
          }}
          <c-button
            text
            size="small"
            @click="closeSharedNotification"
          >
            <c-icon
              :path="mdiClose"
              alt=""
              aria-hidden="true"
            />
            {{ $t("message.share.close") }}
          </c-button>
        </div>
      </c-alert>
      <ShareModalTable
        v-show="sharedDetails.length > 0"
        :shared-details="sharedDetails"
        :bucket-name="bucketName"
        :access-rights="accessRights"
        @removeSharedBucket="removeSharedBucket"
        @updateSharedBucket="updateSharedBucket"
      />
    </c-card-content>
    <c-toasts
      id="shareModal-toasts"
      data-testid="shareModal-toasts"
    />
  </c-card>
</template>

<script>
import {
  addNewTag,
  deleteTag,
} from "@/common/globalFunctions";
import {
  addFocusClass,
  removeFocusClass,
  moveFocusOutOfModal,
} from "@/common/keyboardNavigation";
import { addAccessControlBucketPolicy } from "@/common/s3commands";
import ShareModalTable from "@/components/ShareModalTable.vue";
import TagInput from "@/components/TagInput.vue";
import { mdiClose, mdiInformationOutline } from "@mdi/js";

export default {
  name: "ShareModal",
  components: { ShareModalTable, TagInput },
  data () {
    return {
      tags: [],
      openShareGuide: false,
      read: false,
      write: false,
      loading: false,
      accessRights: [],
      sharedAccessRight: null,
      isShared: false,
      sharedDetails: [],
      isPermissionRemoved: false,
      isPermissionUpdated: false,
      timeout: null,
      mdiClose,
      mdiInformationOutline,
    };
  },
  computed: {
    active() {
      return this.$store.active;
    },
    bucketName() {
      return this.$store.selectedBucketName;
    },
    locale () {
      return this.$i18n.locale;
    },
    visible() {
      return this.$store.openShareModal;
    },
    prevActiveEl() {
      return this.$store.prevActiveEl;
    },
    s3endpoint() {
      return this.$store.s3endpoint;
    },
  },
  watch: {
    locale: function () {
      this.setAccessRights();
    },
    visible: function () {
      if (this.visible && this.bucketName) this.getSharedDetails();
    },
    read: function () {
      if(!this.read) {
        this.write = false;
      }
    },
    write: function () {
      if(this.write) {
        this.read = true;
      }
    },
  },
  created: function () {
    this.setAccessRights();
  },
  methods: {
    onSelectPermission: function(e) {
      const val = e.target.value.value;
      switch (val) {
        case "read":
          this.giveReadAccess();
          break;
        case "read and write":
          this.giveReadWriteAccess();
          break;
      }
    },
    setAccessRights: function () {
      this.accessRights = [
        {
          name: this.$t("message.share.read_perm"),
          value: "read",
          desc: this.$t("message.share.read_perm_desc"),
        },
        {
          name: this.$t("message.share.write_perm"),
          value: "read and write",
          desc: this.$t("message.share.write_perm_desc"),
        },
      ];
    },
    giveReadAccess: function () {
      this.read = true;
      this.write = false;
    },
    giveReadWriteAccess: function () {
      this.read = true;
      this.write = true;
    },
    shareSubmit: function () {
      this.loading = true;
      this.shareContainer(this.bucketName).then((ret) => {
        if (ret) {
          this.getSharedDetails();
          this.closeSharedNotification();
          this.isShared = true;
          this.closeSharedNotificationWithTimeout();
        }
        this.sharedAccessRight = null;
      }).catch(() => {
        // In case of uncaught errors, show generic error
        document.querySelector("#shareModal-toasts").addToast(
          {
            id: "error-fail",
            type: "error",
            duration: 5000,
            persistent: false,
            progress: false,
            message: this.$t("message.share.fail_generic"),
          },
        );
      }).finally(() => {
        this.loading = false;
      });
    },
    shareContainer: async function (bucket) {
      let rights = [];
      if (this.read) {
        rights.push("r");
      }
      if (this.write) {
        rights.push("w");
      }
      if (rights.length < 1) {
        document.querySelector("#shareModal-toasts").addToast(
          {
            id: "error-noperm",
            type: "error",
            duration: 5000,
            persistent: false,
            progress: false,
            message: this.$t("message.share.fail_noperm"),
          },
        );
        return false;
      }
      if (this.tags.length < 1) {
        document.querySelector("#shareModal-toasts").addToast(
          {
            id: "error-noid",
            type: "error",
            duration: 5000,
            persistent: false,
            progress: false,
            message: this.$t("message.share.fail_noid"),
          },
        );
        return false;
      }
      let invalidTags = this.tags.filter(
        item => this.validateTag(item) === false);

      if (invalidTags.length) {
        let msg = invalidTags.join(", ");

        if (invalidTags.length > 1) {
          msg += this.$t("message.share.invalid_share_ids");
        } else {
          msg += this.$t("message.share.invalid_share_id");
        }
        document.querySelector("#shareModal-toasts").addToast(
          {
            type: "error",
            persistent: false,
            progress: false,
            message: msg,
          },
        );
        return false;
      }
      try {
        await this.$store.sharingClient.shareNewAccess(
          this.$store.active.id,
          bucket,
          this.tags,
          rights,
          this.s3endpoint,
        );
        await this.$store.sharingClient.shareNewAccess(
          this.$store.active.id,
          `${this.bucketName}_segments`,
          this.tags,
          rights,
          this.s3endpoint,
        );
      }
      catch(error) {
        if (error.message.match("Container already shared.")) {
          document.querySelector("#shareModal-toasts").addToast(
            {
              id: "error-duplicate",
              type: "error",
              duration: 5000,
              persistent: false,
              progress: false,
              message: this.$t("message.share.fail_duplicate"),
            },
          );
          return false;
        }
        else {
          throw error;
        }
      }

      await addAccessControlBucketPolicy(
        bucket,
        rights,
        this.tags,
      );
      try {
        await addAccessControlBucketPolicy(
          `${bucket}_segments`,
          rights,
          this.tags,
        );
      } catch {}

      // signal to update sharing containers in container table
      this.$store.setSharingUpdated(true);
      return true;
    },
    toggleShareGuide: function () {
      this.openShareGuide = !this.openShareGuide;
    },
    toggleShareModal: function () {
      this.$store.toggleShareModal(false);
      this.$store.setBucketName("");
      this.sharedAccessRight = null;
      this.openShareGuide = false;
      this.tags = [];
      this.isShared = false;
      this.isPermissionRemoved = false;
      document.querySelector("#shareModal-toasts").removeToast("error-noperm");
      document.querySelector("#shareModal-toasts").removeToast("error-noid");
      document.querySelector("#shareModal-toasts")
        .removeToast("error-duplicate");

      moveFocusOutOfModal(this.prevActiveEl);
    },
    closeSharedNotificationWithTimeout() {
      document.getElementById("share-card-modal-content").scrollTo(0, 0);
      this.timeout = setTimeout(() => this.closeSharedNotification(), 3000);
    },
    closeSharedNotification: function () {
      if (this.timeout !== null) {
        clearTimeout(this.timeout);
      }

      this.isShared = false;
      this.isPermissionRemoved = false;
      this.isPermissionUpdated = false;
    },
    getSharedDetails: function () {
      this.$store.sharingClient.getShareDetails(
        this.$route.params.project,
        this.bucketName,
      ).then((ret) => {
        // A failed or non-JSON response must not hide the shares table
        // silently — only accept a proper array
        this.sharedDetails = Array.isArray(ret) ? ret : [];
        this.tags = [];
      }).catch((e) => {
        console.error(
          `Could not fetch existing shares for ${this.bucketName}:`, e);
      });
    },
    updateSharedBucket: function () {
      this.closeSharedNotification();
      this.isPermissionUpdated = true;
      this.closeSharedNotificationWithTimeout();
      this.getSharedDetails();
    },
    removeSharedBucket: function (bucketData) {
      this.closeSharedNotification();
      this.sharedDetails = this.sharedDetails.filter(
        item => {
          return item.sharedTo !== bucketData.projectId.value;
        });
      this.isPermissionRemoved = true;
      this.closeSharedNotificationWithTimeout();
    },
    addingTag: function (e, onBlur) {
      this.tags = addNewTag(e, this.tags, onBlur);
    },
    deletingTag: function (e, tag) {
      this.tags = deleteTag(e, tag, this.tags);
    },
    validateTag: function (tag) {
      //tag should be 32 alphanumeric chars
      //and not own project
      return tag.length === 32 &&
        tag !== this.active.id &&
        tag.match(/^[a-z0-9]+$/) != null;
    },
    handleKeyDown: function (e) {
      const eTarget = e.target;
      const shadowDomTarget = eTarget.shadowRoot?.activeElement;

      const first = document.getElementById("close-share-modal-btn");

      // last element is different between with or without shared list
      let last = null;

      // The real DOM's active element is nested under shadowDOM
      // and cannot be accessed if using event target alone
      let shadowRootActiveEl = null;

      // If there is no shared projects, there is no data table,
      // the last element is Share button
      if (this.sharedDetails.length === 0) {
        last = document.getElementById("share-btn");
      } else {
        /*
          If there is shared list table, the last element in the modal
          would be inside c-pagination and
          it is the last arrow icon used to move to Next page
        */

        if (eTarget.tagName.toLowerCase() === "c-data-table") {
          const pagination = eTarget.shadowRoot.querySelector("c-pagination");
          //  Assign the "last" element when the focus is on pagination
          if (e.composedPath().includes(pagination)) {
            last = pagination.shadowRoot?.querySelectorAll("li")[2];
            shadowRootActiveEl = shadowDomTarget?.shadowRoot?.activeElement;
          }
        }
      }

      if (e.key === "Tab" && !e.shiftKey) {
        // Check if "Tab" is on Share button or the last data-table's arrow
        if (eTarget === last ||
          (last && shadowRootActiveEl === last?.firstChild)) {
          first.tabIndex="0";
          first.focus();
        }
        /*
          If the focus is on the whole data-table, there is no
          specific active shadowDOM element. Therefore, we could remove
          the focus class on table when doing "Tab".
        */
        else if (eTarget.tagName.toLowerCase() === "c-data-table" &&
          shadowDomTarget === null) {
          if (eTarget.classList.contains("button-focus")) {
            removeFocusClass(eTarget);
          }
        }
      } else if (e.key === "Tab" && e.shiftKey) {
        if (eTarget === first) {
          e.preventDefault();
          /*
            When shiftTab is on "first" element, originally the focus
            should move to the previous "last" element -
            which is table's arrow icon for Next page.
            But it is difficult to get that el when the focus is not
            on the table, we focus on the whole table itself instead.
          */
          if (this.sharedDetails.length > 0) {
            last = document.getElementById("shared-projects-table");
          }
          last.tabIndex = "0";
          last.focus();
          if (last === document.activeElement) {
            addFocusClass(last);
          }
        }
        // Remove focus class if either the "last" el is
        // Share button or the whole data-table
        else if (eTarget === last ||
          (eTarget.tagName.toLowerCase() === "c-data-table" &&
            shadowDomTarget === null)
        ) {
          removeFocusClass(last ? last : eTarget);
        }
      }
    },
  },
};
</script>

<style scoped>

#share-select {
  width: 100%;
  margin-bottom: 1.5rem;
}

#select-share-access {
  z-index: 2;
}

div.container {
  width: 100%;
}

c-card-actions {
  padding-top: 0.5rem;
}

c-card-actions > h2 {
  margin: 0 !important;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toggle-instructions {
  justify-content: flex-end;
  align-items: center;
  color: var(--c-primary-600);
}

.guide-content {
  margin-top: 1rem;
  background-color: var(--csc-primary-lighter);
  justify-content: space-between;
  padding: 1rem;
}

.guide-content > li {
  font-size: 0.875rem;
}

c-select {
  color: var(--csc-dark);
  width: 100%;
  & > * {
    font-size: var(--body-font-size);
  }
}

c-link {
  --c-link-hover: none;
  min-width: 60px;
}

c-link > span {
  font-size: 0.875rem;
}

div.flex, .shared-notification {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

div.flex {
  flex-direction: row-reverse;
}

c-alert[type="success"] {
  align-items: center;
  margin-bottom: 1.5rem;
  box-shadow: 2px 4px 4px 0px var(--csc-medium-grey);
  & > .shared-notification {
    color: var(--csc-dark);
  };
}

c-toasts {
  width: fit-content;
}

c-alert[type="success"] {
  align-items: center;
  margin-bottom: 1.5rem;
  box-shadow: 2px 4px 4px 0px var(--csc-medium-grey);
  & > .shared-notification {
    color: var(--csc-dark);
  };
}

</style>
