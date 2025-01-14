type RawAccount = {
  name: string;
  cookie: string;
  proxy: string;
  groups: VKgroup[];
};

type VKgroup = {
  name: string;
  topic: string;
};

export { RawAccount, VKgroup };
