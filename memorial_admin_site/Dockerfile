FROM node:16-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/memorial_admin_site
COPY memorial_admin_site/package.json memorial_admin_site/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY memorial_admin_site ./
ARG REACT_APP_APP_SERVER_ENTRY=http://localhost:4033
ARG REACT_APP_RMS_ENTRY=http://localhost:4034
ENV REACT_APP_APP_SERVER_ENTRY=$REACT_APP_APP_SERVER_ENTRY
ENV REACT_APP_RMS_ENTRY=$REACT_APP_RMS_ENTRY
RUN pnpm build

FROM nginx:1.27-alpine
COPY memorial_admin_site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/memorial_admin_site/build /usr/share/nginx/html
EXPOSE 80
