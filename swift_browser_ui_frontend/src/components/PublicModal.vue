<template>
  <c-card ref="publicCard" class="public-card" @keydown="handleKeyDown">
    <c-card-actions justify="space-between" class="header">
      <div class="header-left">
        <h2 class="title is-4">
          {{ $t("message.public.title") || "Public access" }}
        </h2>
        <div class="subtitle">
          {{
            $t("message.public.subtitle") ||
            "Control anonymous read access to this bucket."
          }}
        </div>
      </div>

      <c-button
        id="close-public-modal-btn"
        data-testid="close-public-modal"
        text
        :disabled.prop="busy"
        @click="close"
        @keyup.enter="close"
      >
        <c-icon :path="mdiClose" alt="" aria-hidden="true" />
        {{ $t("message.close") || $t("message.share.close") || "Close" }}
      </c-button>
    </c-card-actions>

    <c-card-content id="public-card-modal-content">
      <c-container>
        <div class="row">
          <div class="label">
            {{ $t("message.public.bucketLabel") || "Bucket" }}
          </div>
          <div class="value">
            <strong :title="containerName">{{ containerName || "-" }}</strong>
          </div>
        </div>

        <div class="row">
          <div class="label">
            {{ $t("message.public.toggleLabel") || "Public read access" }}
          </div>

          <div class="value inline">
            <c-switch
              id="public-toggle"
              :checked.prop="enabled"
              :disabled.prop="busy || !containerName"
              @input="onToggle"
              @change="onToggle"
            />
          </div>

          <div class="help">
            {{
              $t("message.public.toggleHelp") ||
              "When enabled, anyone with the link can browse and download objects."
            }}
          </div>
        </div>

        <div v-if="enabled" class="link-block">
          <div class="row link-row">
            <div class="label">
              {{ $t("message.public.linkLabel") || "Public link" }}
            </div>

            <div class="value link-right">
              <c-text-field id="public-link" :value.prop="publicLink" readonly />

              <div class="actions">
                <c-button
                  id="public-open"
                  data-testid="public-open"
                  :disabled.prop="!publicLink"
                  @click="openLink"
                  @keyup.enter="openLink"
                >
                  <c-icon :path="mdiOpenInNew" alt="" aria-hidden="true" />
                  {{ $t("message.public.open") || "Open" }}
                </c-button>

                <c-button
                  id="public-copy"
                  data-testid="public-copy"
                  :disabled.prop="!publicLink"
                  @click="copyLink"
                  @keyup.enter="copyLink"
                >
                  <c-icon :path="mdiContentCopy" alt="" aria-hidden="true" />
                  {{ $t("message.public.copy") || "Copy" }}
                </c-button>
              </div>

              <div class="help">
                {{
                  $t("message.public.linkHelp") ||
                  "Share this link carefully. Disable public access to revoke it."
                }}
              </div>

              <div v-if="enabled && !publicLink" class="help">
                {{ $t("message.public.loadingLink") || "Generating link..." }}
              </div>
            </div>
          </div>
        </div>

        <c-toasts id="publicModal-toasts" data-testid="publicModal-toasts" />
      </c-container>
    </c-card-content>
  </c-card>
</template>

<script>
import { mapState } from "vuex";
import { mdiClose, mdiContentCopy, mdiOpenInNew } from "@mdi/js";
import { setContainerPublic } from "@/common/api";
import { moveFocusOutOfModal } from "@/common/keyboardNavigation";

export default {
  name: "PublicModal",
  data() {
    return {
      busy: false,
      enabled: false,
      mdiClose,
      mdiContentCopy,
      mdiOpenInNew,
      _lastToggleAt: 0,
    };
  },
  computed: {
    ...mapState([
      "openPublicModal",
      "publicModalContainer",
      "publicBase",
      "active",
      "prevActiveEl",
    ]),
    containerName() {
      return this.publicModalContainer?.name || "";
    },
    publicLink() {
      if (!this.enabled || !this.publicBase || !this.containerName) return "";
      return `${this.publicBase}/${encodeURIComponent(this.containerName)}/`;
    },
  },
  watch: {
    async openPublicModal(val) {
      if (!val) return;

      this.enabled = !!this.publicModalContainer?.is_public;

      try {
        await this.ensureBase();
      } catch (_) {}

      this.$nextTick(() => {
        setTimeout(() => {
          const el =
            document.querySelector("#public-toggle input") ||
            document.getElementById("close-public-modal-btn");
          el?.focus?.();
        }, 200);
      });
    },
  },
  methods: {
    async ensureBase() {
      if (this.publicBase) return this.publicBase;
      await this.$store.dispatch("ensurePublicBase", {
        projectID: this.active.id,
      });
      return this.publicBase;
    },

    async onToggle(e) {
      const now = Date.now();
      if (now - this._lastToggleAt < 80) return;
      this._lastToggleAt = now;

      if (this.busy || !this.containerName) return;

      const host = e?.currentTarget || e?.target;
      const input = host?.querySelector?.("input");
      const next = !!(input ? input.checked : !this.enabled);

      const prev = this.enabled;
      this.enabled = next;

      this.busy = true;
      try {
        await this.ensureBase();
        await setContainerPublic(this.active.id, this.containerName, next);

        this.$store.dispatch("updateContainers", { projectID: this.active.id });
      } catch (err) {
        this.enabled = prev;
        console.error("[PublicModal] setContainerPublic failed:", err);
      } finally {
        this.busy = false;
      }
    },

    openLink() {
      if (!this.publicLink) return;
      window.open(this.publicLink, "_blank", "noopener,noreferrer");
    },

    async copyLink() {
      if (!this.publicLink) return;
      try {
        await navigator.clipboard.writeText(this.publicLink);
      } catch {
        const el = document.querySelector("#public-link input");
        el?.focus?.();
        el?.select?.();
      }
    },

    close() {
      this.$store.commit("togglePublicModal", false);
      this.$store.commit("setPublicModalContainer", null);
      moveFocusOutOfModal(this.prevActiveEl);
    },

    handleKeyDown(e) {
      const first = document.getElementById("close-public-modal-btn");
      const toggle = document.querySelector("#public-toggle input");
      const openBtn = document.querySelector("#public-open button");
      const copyBtn = document.querySelector("#public-copy button");

      const last = this.enabled
        ? copyBtn || openBtn || toggle || first
        : toggle || first;

      if (e.key === "Tab" && !e.shiftKey) {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus?.();
        }
      } else if (e.key === "Tab" && e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus?.();
        }
      }
    },
  },
};
</script>

<style scoped>
.public-card {
  padding: 1.5rem;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  max-height: 65vh;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  overflow: auto;
  border-radius: 8px;
}

.header {
  margin-bottom: 0.75rem;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.subtitle {
  color: var(--csc-dark-grey);
  font-size: 0.95rem;
}

.row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 0.75rem 1rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.label {
  color: var(--csc-dark-grey);
}

.value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value.inline {
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.help {
  grid-column: 2 / 3;
  justify-self: start;
  text-align: left;
  align-self: start;

  color: var(--csc-dark-grey);
  font-size: 0.9rem;
  line-height: 1.25rem;
  margin-top: -0.25rem;
}

.link-block {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--csc-light-grey);
}

.link-row {
  align-items: start;
}

.link-right {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  white-space: normal;
}

.actions {
  display: flex;
  justify-content: flex-start;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

@media screen and (max-width: 767px), (max-height: 580px) {
  .public-card {
    top: -5rem;
  }
}
</style>
