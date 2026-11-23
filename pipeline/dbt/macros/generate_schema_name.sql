{#
  Nombres de dataset por target (guía, sección 3: dev y prod separados).
  prod: el nombre de la capa tal cual (staging, intermediate, marts, history, ref).
  dev (o cualquier otro target): prefijo del dataset del target (dev_staging, dev_marts...).
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- elif target.name == 'prod' -%}
        {{ custom_schema_name | trim }}
    {%- else -%}
        {{ target.schema }}_{{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
