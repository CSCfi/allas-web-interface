
let bucket_overrides = {
  en: {
    message: {
      index: {
        formName: "CSC Account",
        loginmethods: [
          {
            msg: "Log In",
            href: "/login/oidc_front",
          },
        ],
      },
      error: {
        inUse: "Bucket name is already in use.",
        inUseOtherPrj: "Bucket name is already in use by another project.",
        invalidName: "Bucket name or tag is invalid.",
        createFail: "Bucket creation failed.",
        forbiddenChars: "Bucket name cannot contain special " +
        "characters other than dot(.), hyphen(-), and underscore(_)",
        segments: "Bucket name cannot end with '_segments'",
      },
      dropFiles: "Drag and drop buckets here or ",
      createFolder: "Create bucket",
      program_name: "Allas",
      program_description: "Allas Web UI provides a simple-to-use web user " +
          "interface for CSC Object Storage service, Allas.",
      helplink: "https://docs.csc.fi/data/Allas/",
      folderTabs: {
        all: "All buckets",
        sharedFrom: "Buckets you have shared",
        sharedTo: "Buckets shared with you",
      },
      folderDetails: {
        notShared: "This bucket isn't shared with other projects.",
        sharing_to_one_project: "This bucket is shared to one project.",
        sharing_to_many_projects: "This bucket is shared to multiple" +
            "projects.",
        shared_with_view:
          "You can browse this bucket. (@:message.share.view_perm)",
        shared_with_read:
          "You can copy this bucket and download objects." +
          " (@:message.share.read_perm)",
        shared_with_read_write:
          "You can copy this bucket and download objects."  +
          " You can upload new objects or delete existing objects from this " +
          "bucket. (@:message.share.write_perm)",
      },
      table: {
        source_project_id: "Share ID of this bucket",
        back_to_all_folders: "Back to all buckets",
        back_to_sharing_folders: "Back to buckets you have shared",
        back_to_shared_folders: "Back to buckets shared with you",
      },
      tableOptions: {
        render: "Display as Folders and Objects",
        text: "Display as object paths",
      },
      share: {
        share_id_tooltip:
          "With this action, you can copy the Share ID: " +
          "a unique 32-digit code associated with your {tooltipb} " +
          "project. Provide the Share ID to members " +
          "of other projects (e.g., via email) so that they can " +
          "share buckets with you.",
        instructions: "How to share a bucket",
        share_title: "Share bucket",
        share_guide_intro:
          "To share a bucket with another project you need to:",
        share_guide_step1:
          "You need to know in advance " +
          "the Share ID (a 32-digit code) associated " +
          "with the project you want to share a bucket with. The " +
          "recipient can copy the Share ID from the user " +
          "interface and provide it to you via email. You can share " +
          "a bucket with multiple projects.",
        view_perm_desc:
          ": The recipient project's members can only " +
          "view the bucket content. Use this when you " +
          "need maximum certainty that your objects are not distributed " +
          "further. Note that you have to be also the project manager of " +
          "the recipient project.",
        read_perm_desc:
          ": The recipient project's members can copy your bucket " +
          "and download objects. Use this when you want to " +
          "transfer your data to another project.",
        write_perm_desc:
          ": In addition to @:message.share.read_perm permission, " +
          "the recipient project's members can upload new objects or delete " +
          "existing objects from your bucket. Use this when " +
          "you want the bucket to be your shared workspace.",
        shared_successfully: "Bucket was shared successfully!",
        shared_table_title: "This bucket is shared with",
        fail_duplicate: "The project already has access to the bucket.",
      },
      emptyContainer: "This bucket/folder has no content.",
      emptyProject: {
        all: "There are no buckets in this project.",
        sharedFrom: "You haven't shared any buckets.",
        sharedTo: "No buckets have been shared with you.",
      },
      containers: "Buckets - ",
      download: {
        files: "Objects can only be downloaded " +
          "individually because there are object or subbucket names longer" +
          " than 99 characters.",
        gathering: "Gathering a list of objects",
        warnTempFiles: "Opening temporary objects or buckets " +
          "(.crdownload, .crswap) may interrupt the process.",
      },
      upload: {
        duplicate: "Objects with the same paths are not allowed.",
        sizeZero: "Empty objects cannot be uploaded.",
        viewDestinationFolder: "View destination bucket",
        addFiles: "Please add objects to upload.",
        accessFail: "Bucket could not be accessed.",
      },
      copyfail: "Failed to copy the bucket",
      notDecryptable: "Some requested objects could not be decrypted.",
      container_ops: {
        addContainer: "Create new bucket",
        norename:
          "Please note that bucket names cannot be modified " +
          "after creating a bucket.",
        createdFolder:
          "Created bucket will be shared with all project members in ",
        deleteNote: "Bucket must be empty before " + "it can be deleted.",
        deleteSuccess: "Bucket was deleted.",
        folderName: "Bucket name",
      },
      subfolders: {
        deleteOneSuccess: "Subbucket was deleted.",
        deleteManySuccess: "Subbuckets were deleted.",
      },
      objects: {
        file: "Object ",
        files: "Objects ",
        overwriteConfirm: " already exists. Do you want to replace " +
        "this object? (Previous object will be lost.)",
        overwriteConfirmMany:
          " already exist. Do you want to replace these objects? " +
          "(Previous objects will be lost.)",
        deleteSharedObjects:
          "This action will permanently delete " +
          "items from a shared bucket. " +
          "Are you sure you want to proceed?",
      },
      replicate: {
        copy_folder: "Copy bucket: ",
        name_newFolder: "Name new bucket",
      },
      encrypt: {
        uploadFiles: "Upload objects",
        uploadDestination: "Destination bucket: ",
        upload_step1: "Create a new bucket",
        upload_step2: "Objects to be uploaded",
        dropMsg: "Select objects",
        uploadedToShared:
          "and all members in other projects which " +
          "have access to this shared bucket.",
        empty: "No objects selected",
        uploadedFiles:
          "Uploaded objects will be shared with all project members in ",
      },
      search: {
        container: "Bucket",
        folder: "Folder",
        buildingIndex:
        "This project has a large number of objects. Please " +
        "wait a moment and try again.",
      },
    },
    label: {
      folder_tabs: "different types of buckets",
      searchbox: "search for buckets",
    },
  },
  fi: {
    message: {
      formName: "CSC Käyttäjä",
      index: {
        loginmethods: [
          {
            msg: "Kirjaudu",
            href: "/login/oidc_front",
          },
        ],
      },
      error: {
        inUse: "Ämpärin nimi on jo käytössä.",
        inUseOtherPrj: "Ämpärin nimi on jo käytössä toisessa projektissa.",
        invalidName: "Ämpärin nimi tai asiasana ei kelpaa.",
        createFail: "Ämpärin luonti epäonnistui.",
        forbiddenChars: "Ämpärin nimi ei voi sisältää muita " +
        "erikoismerkkejä kuin piste(.), viiva(-) ja alaviiva(_)",
        segments: "Ämpärin nimi ei saa päättyä '_segments'.",
      },
      dropFiles: "Vedä ja pudota ämpärit tähän tai ",
      createFolder: "Luo Ämpäri",
      program_name: "Allas",
      program_description: "Allas Web UI tarjoaa yksinkertaisen " +
          "web-käyttöliittymän CSC:n Object Storage -palveluun, Altaaseen.",
      helplink: "https://docs.csc.fi/data/Allas/",
      folderTabs: {
        all: "Kaikki ämpärit",
        sharedFrom: "Jakamasi ämpärit",
        sharedTo: "Sinulle jaetut ämpärit",
      },
      folderDetails: {
        notShared: "Tätä ämpäriä ei ole jaettu toiselle projektille.",
        sharing_to_one_project: "Tämä ämpäri on jaettu yhdelle projektille.",
        sharing_to_many_projects: "Tämä ämpäri on jaettu useille projekteille.",
        shared_with_view:
          "Voit tarkastella tätä ämpäriä. (@:message.share.view_perm)",
        shared_with_read:
          "Voit kopioida ämpärisi, ladata " +
          "objekteja tässä ämpärissä ja purkaa ämpärin sisällön " +
          "salauksen. (@:message.share.read_perm)",
        shared_with_read_write:
          "Voit kopioida ja ladata " +
          "objekteja sekä purkaa ämpärin sisällön salauksen. " +
          "Voit lähettää uusia tai poistaa jo ämpärissä olevia objekteja. " +
          "(@:message.share.write_perm)",
      },
      table: {
        folderDetails: "Ei yksityiskohtia ämpäreille",
        fileDown: "Objektin lataus",
        item: "Objekti",
        items: "Objektit",
        itemsPerPage: "Objektit sivulla: ",
      },
      tableOptions: {
        render: "Näytä objektit ämpäreissä",
        text: "Näytä objektit polkuina",
      },
      share: {
        share_id_tooltip:
          "Tällä toiminnolla voit kopioida jakamistunnuksen: uniikin " +
          "32-numeroisen koodin, joka on yhdistetty {tooltipb} " +
          "projektiin. Lähetä tunnus (esim. sähköpostilla) muiden projektien " +
          "jäsenille, niin he voivat jakaa ämpäreitä sinulle.",
        instructions: "Kuinka jaan ämpärin",
        share_title: "Jaa ämpäri",
        share_guide_intro: "Kun haluat jakaa ämpärin toisen projektin kanssa: ",
        share_guide_step1:
          "Sinun tulee tietää " +
          "vastaanottavan projektin jakamistunnus (32-numeroinen " +
          "koodi). Vastaanottaja voi kopioida " +
          "jakamistunnuksen Kopioi jakamistunnus -napilla " +
          "ja lähettää sen sinulle esim. sähköpostilla. " +
          "Voit jakaa ämpärin useiden projektien kanssa.",
        view_perm_desc:
          ": Vastaanottavan projektin jäsenet voivat tarkastella ämpärin " +
          "sisältöä. Käytä tätä, kun tarvitset varmuuden, ettei " +
          "ojektijasi jaeta eteenpäin. Huomaa, että " +
          "sinun tulee olla myös vastaanottavan projektin omistaja.",
        read_perm: "Siirrä objektit",
        read_perm_desc:
          ": Vastaanottavan projektin jäsenet voivat kopioida ämpärisi " +
          ", ladata objektit sekä purkaa ämpärin sisällön salauksen. " +
          "Käytä tätä, kun haluat siirtää objektejasi toiselle projektille.",
        write_perm_desc:
          ": @:message.share.read_perm -oikeuksien lisäksi vastaanottavan " +
          "projektin jäsenet voivat lähettää uusia tai poistaa jo ämpärissä " +
          "olevia objekteja. Käytä tätä, kun haluat käyttää " +
          "ämpäriä jaettuna työtilana.",
        shared_successfully: "Ämpärin jakaminen onnistui.",
        shared_table_title: "Tämä ämpäri on jaettu",
        fail_duplicate: "Ämpäri on jo jaettu kyseiselle projektille.",
      },
      emptyContainer: "Tämä ämpäri/kansio on tyhjä.",
      emptyProject: {
        all: "Tässä projektissa ei ole ämpäreitä.",
        sharedFrom: "Et ole jakanut yhtään ämpäriä.",
        sharedTo: "Sinulle ei ole jaettu ämpäreitä.",
      },
      containers: "Ämpärit - ",
      download: {
        files: "Objektit voidaan ladata vain " +
          "erikseen, koska objektien tai alikontioiden nimet ovat " +
          "yli 99 merkkiä pitkiä.",
        gathering: "Haetaan listaa objektitiedostoista",
        warnTempFiles: "Väliaikaisten objektien tai ämpäreiden " +
        "(.crdownload, .crswap) avaaminen voi keskeyttää latauksen.",
      },
      upload: {
        duplicate: "Objektit, joilla on samat polut, eivät ole sallittuja.",
        sizeZero: "Tyhjiä objekteja ei voi lähettää.",
        viewDestinationFolder: "Näytä kohdeämpäri",
        uploadedItems: "Lähetetyt objektit näytetään pian",
        addFiles: "Lisää ladattavat objektit.",
        accessFail: "Ämpäriin ei ole pääsyä.",
      },
      copysuccess: "Ämpäriä kopioidaan",
      copyfail: "Ämpärin kopiointi epäonnistui",
      notDecryptable: "Salauksen purkaminen epäonnistui osassa objekteista.",
      container_ops: {
        addContainer: "Luo uusi Ämpäri",
        norename:
          "Ämpäriä ei voi nimetä uudelleen, " +
          "mutta sen voi kopioida uudella nimellä.",
        createdFolder: "Luotu ämpäri jaetaan kaikille jäsenille projektissa ",
        viewProjectMembers: "Näytä projektin jäsenet",
        deleteNote:
          "Ämpärin poistaminen edellyttää kaikkien " +
          "objektien poistamista ensin.",
        deleteSuccess: "Ämpäri poistettu",
        folderName: "Ämpärin nimi",
      },
      subfolders: {
        deleteNote:
          "Alikontin poistaminen edellyttää sen kaikkien " +
          "objektien poistamista.",
        deleteOneSuccess: "Alikontti poistettu.",
        deleteManySuccess: "Alikontit poistettu.",
      },
      objects: {
        file: "Objekti ",
        files: "Objektit ",
        overwriteConfirm:
          " on jo olemassa. Haluatko korvata objektin? " +
          "(Edellinen objekti poistetaan.)",
        overwriteConfirmMany:
          " ovat jo olemassa. Haluatko korvata objektit? " +
          "(Edelliset objektit poistetaan.)",
        deleteConfirm: "Poista objektit",
        deleteObjects: "Poista objektit",
        deleteManySuccess: " objektit poistettu",
        deleteOneSuccess: " objekti poistettu",
        deleteSharedObjects:
         "Tällä toiminnolla poistat " +
         "objektit jaetusta ämpäristä pysyvästi. " +
         "Haluatko varmasti poistaa nämä objektit?",
        deleteObjectsMessage:
          "Objekteja ei voi palauttaa poistamisen jälkeen. " +
          "Haluatko varmasti poistaa nämä objektit?",
      },
      replicate: {
        copy_folder: "Kopioi ämpäri: ",
        name_newFolder: "Nimeä uusi ämpäri",
      },
      encrypt: {
        uploadFiles: "Lataa objektit",
        uploadDestination: "Kohdeämpäri: ",
        upload_step1: "Luo uusi ämpäri",
        upload_step2: "Ladattavat objektit",
        dropMsg: "Valitse objektit",
        empty: "Ei valittuja objekteja",
        uploadedFiles:
          "Lähetetyt objektit jaetaan kaikille jäsenille projektissa ",
        uploadedToShared:
          "ja myös kaikille jäsenille muissa projekteissa, " +
          "joilla on pääsy tähän jaettuun ämpäriin.",
      },
      search: {
        container: "Ämpäri",
        object: "Objekti",
        folder: "Alikontti",
        objects: "Objektit",
        buildingIndex:
          "Tässä projektissa on paljon objekteja. Odota " +
          "hetki ja yritä uudelleen.",
      },
      select: {
        description:
          "Käyttäjällä on pääsy rajoitettuihin projekteihin. " +
          "Selatessa rajoitettua projektia käyttöliittymän pääsy on " +
          "rajattu, eli vain rajatun projektin sisältö on näkyvissä. " +
          "Objektin kopiointi ja siirto projektista toiseen, ja " +
          "muiden projektien sisällön selailu on estetty. Valitse " +
          "projekti, jota haluat käyttää. Valinnan jälkeen projektin " +
          "vaihto onnistuu vain kirjautumalla ulos. Mikäli haluat " +
          "selailla vain rajoittamattomia projekteja, paina " +
          "rajoittamattomien projektien nappia alla.",
      },
    },
    label: {
      folder_tabs: "erityyppisiä ämpäreitä",
      searchbox: "etsi ämpäreitä",
    },
  },
};


export default bucket_overrides;
