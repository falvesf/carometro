# Carômetro Geral — Cadastro e Impressão Padrão

Sistema local para cadastro, consulta, navegação entre registros, impressão A4 e geração de PDF de funcionários e professores, mantendo fielmente a diagramação oficial do carômetro.

## Principais Recursos
- **Banco de dados SQLite local (`data/carometro.db`)**: funciona offline/em rede local e nunca sai do ar.
- **Cadastro completo**: Código/Matrícula, Nome, CPF, Endereço, Data de Nascimento, Sexo, E-mail, RG, Órgão emissor, Data de emissão, Data de contratação, Data de demissão, Assinatura digitalizada, Telefones, Foto, Categoria (`Professor` / `Funcionário`) e Cargo.
- **Consulta e filtros**: busca por nome, código, CPF, RG, e-mail, endereço, telefone ou cargo, filtros por categoria/status e seleção para impressão.
- **Navegação entre registros**: botões `|< Primeiro`, `< Anterior`, `Próximo >`, `Último >|` (e atalhos `Alt + ←` / `Alt + →`) com prévia ao vivo do cartão.
- **Impressão e PDF fiéis ao modelo**: layout A4 (`595×842pt`, 7 fichas por página, logotipo, bordas, check verde e rodapé).
- **Backup e restauração**: exportação em `.json` ou `.db` e importação em `.json` pela tela **Configurações & Backup**.

## Como Executar

**Requisitos:** Node.js v22+ (utiliza `node:sqlite` nativo; testado no Node v24).

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie o sistema:
   ```bash
   npm start
   ```
   Ou dê um duplo clique em `Iniciar Carometro.bat` (Windows).
3. Acesse no navegador:
   ```
   http://localhost:3000
   ```

## Privacidade (LGPD)
Por segurança, o banco `data/`, as fotos enviadas em `data/uploads/`, o PDF modelo (`carometro.pdf`) e o arquivo `seed/` estão listados no `.gitignore` para que dados pessoais (CPF, RG, endereço, telefone e fotos) não sejam expostos no repositório. Use a opção de backup `.json` dentro do próprio sistema para transferir registros entre computadores.
