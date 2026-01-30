<template>
  <div v-if="isVisible" class="cookie-modal-overlay">
    <div class="cookie-modal">

      <div class="modal-header">
        <h2><strong>COOKIES</strong></h2>
        <button class="close-btn" @click="acknowledge">✖ Close</button>
      </div>

      <p>
        We and our business partners use technologies, including cookies, to
        collect information about you for the following purposes:
      </p>
      <ul>
        <br>
        <li>•  Functional (strictly necessary — used to manage your session and
        remember your language preference)</li>
        <br>
      </ul>
      <p>
        By continuing to use this service, you are informed about and accept the
        use of these cookies.
      </p>
      <br>

      <!-- Accordion Section -->
      <div class="accordion">

        <details class="main-details">
          <summary class="main-summary">
            General information about cookies
          </summary>
          <div class="sub-accordion">
            <details>
              <summary><strong>What is a cookie?</strong></summary>
              <br>
              <p>A cookie is a small data file stored in your computer, tablet
              or smartphone. A cookie is not a program that can contain harmful
              malware or virus.</p>
            </details>
            <details>
              <summary><strong>How long are cookies stored?</strong></summary>
              <br>
              <p>The length of time a cookie is stored on your devices and
              browsers varies. The lifetime is calculated according to your last
              visit to the website. When a cookie expires, it is automatically
              deleted. All our cookies' lifetimes are specified in our cookie
              policy.</p>
            </details>
            <details>
              <summary><strong>How can you block cookies?</strong></summary>
              <br>
              <p>You may at any time block all or just third-party cookies
              completely by changing the browser settings on your computer,
              tablet, or smartphone. The location of these settings will depend
              on the browser you use. However, you should be aware that if you
              block all or just third-party cookies, there may be functions and
              services that you will be unable to use on the website (because
              these depend on cookies).</p>
            </details>
            <details>
              <summary><strong>How can you delete cookies?</strong></summary>
              <br>
              <p>It is easy to delete cookies that you have previously accepted.
              It depends on which browser (Chrome, Firefox, Safari, etc.) and
              device (smartphone, tablet, PC, Mac) you are using. You can
              typically find this information under settings → Security and
              Privacy, but this may vary from one browser to another. Specify
              which device / browser you are using (click the appropriate
              link):</p>
              <ul>
              <li>
                <a href="https://support.microsoft.com/en-us/microsoft-edge/
                delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-/
                2a946a29ae09"
                target="_blank"
>Microsoft Edge</a>
              </li>
              <li>
                <a href="https://support.mozilla.org/en-US/kb/clear-cookies-and
                -site-data-firefox" target="_blank"
>Mozilla Firefox</a>
              </li>
              <li>
                <a href="https://support.google.com/chrome/answer/95647"
                target="_blank"
>Google Chrome</a>
              </li>
              <li>
                <a href="https://help.opera.com/en/latest/web-preferences/#cookies"
                target="_blank"
>Opera</a>
              </li>
              <li>
                <a href="https://support.apple.com/guide/safari/manage-cookies
                -and-website-data-sfri11471/mac" target="_blank"
>Safari</a>
              </li>
              <li>
                <a href="https://support.google.com/chrome/answer/95647?co=GENIE
                .Platform%3DAndroid" target="_blank"
>Chrome (Android)</a>
              </li>
            </ul>
            </details>
            <details>
              <summary><strong>How can you change your consent?</strong>
              </summary>
              <br>
              <p>You can change your consent by either deleting cookies from
              your browser or by clicking "Cookie settings" from the user
              menu in the top right corner of the page.</p>
              <br>
              <p>Remember: If you use more than one browser, you must delete
              cookies in all of them.</p>
            </details>
            <details>
              <summary><strong>Do you have any questions?</strong></summary>
              <br>
              <p>If you have any comments or questions relating to our
              information and / or processing of personal data, please feel
              welcome to contact us. The cookie policy itself is updated once a
              month by Cookie Information. If you have any questions about our
              cookie policy, you are welcome to contact CSC's Communications.
              </p>
            </details>
          </div>
        </details>
        <details class="main-details">
          <summary class="main-summary">
            Cookies used in Allas
          </summary>
          <br>
          <p>This service uses the following cookies:</p>
          <ul>
            <br>
            <li><strong> session</strong> — Manages your session while using the
            service and is deleted when you close your browser.</li>
            <br>
            <li><strong>language</strong> — Remembers your preferred language.
            </li>
            <br>
          </ul>
        </details>

      </div>

      <div class="modal-footer">
        <button @click="acknowledge" class="acknowledge-btn">I acknowledge
        </button>
      </div>

    </div>
  </div>
</template>

<script>
export default {
  name: "CookieConsentModal",
  data() {
    return {
      isVisible: false,
    };
  },
  mounted() {
    if (!localStorage.getItem("cookiesAcknowledged")) {
      this.isVisible = true;
    }
  },
  methods: {
    acknowledge() {
      localStorage.setItem("cookiesAcknowledged", "true");
      this.isVisible = false;
    },
  },
};
</script>

<style scoped>
.cookie-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.cookie-modal {
  background: white;
  padding: 1.5rem;
  width: 90%;
  max-width: 600px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,47,84);
  font-family: Arial, sans-serif;
  position: relative;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #002f54;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: #002f54;
  font-weight: bold;
  padding: 0.3rem 0.8rem;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.close-btn:hover {
  background-color: rgb(204, 216, 215);
}

.main-summary {
  background-color: #ffffff;
  color: #002f54;
  padding: 0.7rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;

}

.sub-accordion details {
  margin: 0.5rem 0;
  background: #fffdfd;
  padding: 0.5rem;
  border-radius: 4px;
}

details summary {
  cursor: pointer;
}

.acknowledge-btn {
  background-color: #002f54;
  color: white;
  padding: 0.7rem 1.5rem;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  border-radius: 4px;
}

.acknowledge-btn:hover {
  background-color: rgb(80, 151, 141);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}
</style>
