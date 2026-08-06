import { createApp } from "vue";

import { i18n } from "@/common/i18n";

import { checkIDB } from "@/common/idb";

import { defineCustomElements } from "@cscfi/csc-ui/loader";
import { vControl } from "@cscfi/csc-ui-vue";

import CFooter from "@/components/CFooter.vue";
import CookieConsentModal from "@/components/CookieConsentModal.vue";
import MainToolbar from "@/components/MainToolbar.vue";

import "@/assets/main.css";

defineCustomElements();

export function newApp(name, data, Component) {
  return createApp({
    name: name,
    components: {
      CFooter,
      CookieConsentModal,
      MainToolbar,
    },
    data: data,
    created() {
      document.title = this.$t("message.program_name");
    },
    mounted: function() {
      // Login card content doesn't fill the card due to an invisible svg
      const targetNode = document.querySelector("form");
      if (targetNode) {
        const observer = new MutationObserver(() => {
          // Remove the svg once it appears in DOM
          const svg = targetNode.querySelector("c-login-card > article > svg");
          if (svg) {
            svg.remove();
            observer.disconnect();
          }
        });
        observer.observe(targetNode, { childList: true, subtree: true });
      }

      // Plausible analytics. The site is keyed by data-domain, so the
      // same code serves every deployment: events are attributed to
      // whichever site matching this hostname is registered in the
      // Plausible admin (unregistered hostnames are simply dropped).
      const host = window.location.hostname;
      if (host !== "localhost" && !host.startsWith("127.")) {
        const script = document.createElement("script");
        script.setAttribute("defer", "");
        script.setAttribute("data-domain", host);
        script.setAttribute("src", "https://stats.rahtiapp.fi/js/script.outbound-links.js");
        document.head.appendChild(script);
      }

      checkIDB().then(result => this.idb = result);
    },
    methods: {
      setCookieLang: function() {
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1);
        document.cookie = "OBJ_UI_LANG=" +
                          i18n.locale +
                          "; path=/; expires="
                          + expiryDate.toUTCString();
      },
    },
    ...Component,
  })
    .use(i18n)
    .directive("csc-control", vControl);
}
