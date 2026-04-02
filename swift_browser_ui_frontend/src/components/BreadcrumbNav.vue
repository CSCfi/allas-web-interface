
<template>
  <div class="breadcrumb">
    <c-row
      align="center"
    >
      <router-link
        :to="{ name: 'AllBuckets'}"
        @click="onClickBreadcrumb"
      >
        <i class="mdi mdi-home" />
        <span>&nbsp;{{ $t("message.bucketTabs.all") }}</span>
      </router-link>
      <router-link
        class="link"
        :to="{name: currentRoute}"
        @click="onClickBreadcrumb"
      >
        <i class="mdi mdi-chevron-right" />
        <span :class="folders.length === 0 ? 'last' : 'default'">
          &nbsp;{{ bucket }}
        </span>
      </router-link>

      <router-link
        v-for="item, i in folders"
        :key="item"
        :to="getPath(i)"
        @click="onClickBreadcrumb"
      >
        <i class="mdi mdi-chevron-right" />
        <span :class="i === folders.length-1 ? 'last': 'default'">
          &nbsp;{{ item }}
        </span>
      </router-link>
    </c-row>
  </div>
</template>

<script>

export default {
  name: "BreadcrumbNav",
  computed: {
    bucket() {
      return this.$route.params.container;
    },
    folders() { // array of folder titles
      const raw = this.$route.query.prefix || "";
      if (!raw) return [];
      // strip trailing slashes and remove empty segments
      return raw.replace(/\/+$/, "").split("/").filter(Boolean);
    },
    currentRoute() {
      return this.$route.name;
    },
  },
  methods: {
    onClickBreadcrumb() {
      this.$emit("breadcrumbClicked", true);
    },
    getPath(index) {
      // construct route object for router-link
      const parts = ((this.$route.query.prefix || "").replace(/\/+$/, ""))
        .split("/")
        .filter(Boolean);

      // last item is current folder, so link to it without prefix
      if (index === this.folders.length - 1) {
        return { name: this.currentRoute, query: { prefix: parts.join("/") } };
      } else {
        const prefix = parts.slice(0, index + 1).join("/");
        return { name: this.currentRoute, query: { prefix } };
      }
    },
  },
};

</script>

<style scoped>

i, p {
    color: var(--csc-primary);

}

.breadcrumb {
  padding: 1.5rem 0 1rem 0;
}

.breadcrumb a {
  align-items: center;
  color: var(--csc-primary);
  display: flex;
  justify-content: center;
  padding: 0;
}

.breadcrumb a span {
  padding: 0 0.5em;
}

.last {
  font-weight: 700;
}
.default {
  font-weight: 400;
}

</style>
