#!/usr/bin/env node

const { JSDOM } = require('jsdom')
const fs = require('fs-extra')
const marked = require('marked')
const http = require('http')
const chokidar = require('chokidar')
const fm = require('front-matter')
const yaml = require('yaml')
const { cp } = require('fs')

// attributes: { template: "custom.html" }
// body: "# My normal markdown ..."
const scriptArgs = process.argv.slice(2)
const command = scriptArgs[0]
let blogPages = []
let postsPerPage = 10

switch (command) {
    case 'init':
        init()
        break
    case 'build':
        build()
        break
    case 'develop':
        develop(scriptArgs[1] ? Number(scriptArgs[1]) : 8000)
        break
    default:
        console.log(`Command 'teeny ${command}' does not exist.`)
        process.exit(1)
}

async function init() {
    await safeExecute(async () => await fs.mkdir('pages/'))
    await safeExecute(async () => await fs.mkdir('static/'))
    await safeExecute(async () => await fs.mkdir('templates/'))

    const examplePage = `---\ntemplate: homepage\n---\n# Hello World`
    const exampleTemplate = `<html><body><p>My first Teeny page</p><div id='page-content'></div><script type="text/javascript" src='main.js'></body></html>`
    const defaultTemplate = `<html><body><div id='page-content'></div></body></html>`
    const exampleStaticAssetJs = `console.log('hello world')`

    await fs.writeFile('pages/index.md', examplePage)
    await fs.writeFile('templates/homepage.html', exampleTemplate)
    await fs.writeFile('templates/default.html', defaultTemplate)
    await fs.writeFile('static/main.js', exampleStaticAssetJs)
}

async function build() {
    blogPages = []
    await fs.emptyDir('public/')

    await safeExecute(
        async () =>
            // Copy files in 'templates' to 'public' but filter out files that start with '.' or end with '.html'
            await fs.copy('templates/', 'public/', { filter: (f) => !f.startsWith('.') && !f.endsWith('.html') })
    )
    await safeExecute(
        // Copy files in 'pages' to 'public' but filter out files that start with '.' or end with '.md'
        async () => await fs.copy('pages/', 'public/', { filter: (f) => !f.startsWith('.') && !f.endsWith('.md') })
    )
    // Copy files in 'static' to 'public' but filter out files that start with '.'
    await safeExecute(async () => await fs.copy('static/', 'public/'), { filter: (f) => !f.startsWith('.') })

    // let contents = await fs.readdir('public')
    // console.log(contents)

    await processDirectory('pages')
}

async function processDirectory(directoryPath) {
    let contents = await fs.readdir(`${directoryPath}/`)
    // console.log(contents)
    const processPagePromises = []
    for (const element of contents) {
        const isDirectory = (await fs.lstat(`${directoryPath}/${element}`)).isDirectory()
        if (isDirectory) {
            await processDirectory(`${directoryPath}/${element}`, processPagePromises)
            continue
        }
        if (!element.startsWith(".")) {
            processPagePromises.push(processPage(`${directoryPath}/${element}`))
        }
    }
    await Promise.all(processPagePromises)
    await blogIndex()
    await fs.writeFile('public/CNAME', 'www.jasonhallen.com')
}

async function processPage(pagePath) {
    let templatePath = 'templates/default.html'
    // Read raw text of .md file
    const fileData = await fs.readFile(pagePath, 'utf-8')
    // Parse raw text into frontmatter and markdown
    let { attributes: frontmatter, body: markdown } = await fm(fileData)

    // Skip page is set to "publish: no"
    if (frontmatter.publish === "no") {
        return
    }
    // If there's a template, use this template instead of "default.html"
    if (frontmatter.template) {
        templatePath = `templates/${frontmatter.template}.html`
    }
    // Generate DOM of template HTML
    const dom = await JSDOM.fromFile(templatePath)
    const document = dom.window.document
    
    // Parse the path into directory and page name
    const pagePathParts = pagePath.replace('pages/', '').split('/')
    const pageName = pagePathParts.pop().split('.md')[0]
    const targetPath = pagePathParts.join('/')
    console.log(pagePath)
    console.log(pageName)
    console.log(targetPath)

    // Insert the "component_head" template into "head" element of document
    const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
    const headElement = document.getElementsByTagName('head')
    headElement[0].innerHTML = headElement[0].innerHTML + componentHead
    
    const componentHeader = await fs.readFile('templates/component_header.html', 'utf-8')
    const headerElement = document.querySelector('#header')
    headerElement.insertAdjacentHTML('afterbegin', componentHeader);
    
    const navElement = document.querySelector('#nav')
    if (navElement) {
        // Select all the anchor elements within the nav
        const links = navElement.querySelectorAll('a');
        // console.log(links)

        // Loop through each link
        links.forEach(link => {
            // Get the href attribute
            const href = link.getAttribute('href');

            // Check if the href contains the string to match
            if (href) {
                if (href.includes(pageName) || href.includes(targetPath)) {
                    // Get the parent li element
                    const parentLi = link.parentElement;
                    
                    // Add the 'active' class to the parent li
                    if (parentLi) {
                        parentLi.classList.add('active');
                    }
                }
            }
        });
    }

    // Append page keywords to default website keywords
    if (frontmatter.keywords) {
        let keywords = headElement[0].getElementsByTagName("meta").keywords
        keywords.content = keywords.content + ', ' + frontmatter.keywords
    }

    // Add description to meta element
    if (frontmatter.description) {
        let description = headElement[0].getElementsByTagName("meta").description
        description.content = frontmatter.description
    }

    // Add cover image
    if (frontmatter.image && !frontmatter.imageCaption) {
        markdown = `<figure><img class="cover-image" src='${frontmatter.image}' alt='${frontmatter.imageAlt}'></figure>\n\n` + markdown
    }
    else if (frontmatter.image && frontmatter.imageCaption) {
        markdown = `<figure><img class="cover-image" src='${frontmatter.image}' alt='${frontmatter.imageAlt}'><figcaption>${frontmatter.imageCaption}</figcaption></figure>\n\n` + markdown
    }

    let latest_roll = false;
    // Add H2 title
    if (frontmatter.title) {
        if (targetPath === "photo") {
            // Insert title with roll dropdown
            let image_page_header = await rollPage(frontmatter.title)
            if (frontmatter.film) {
                image_page_header += `<p class="muted photo-metadata">${frontmatter.film}</br>${frontmatter.camera}</br>${frontmatter.dates}</p>`
            }
            markdown = image_page_header + markdown
            let roll_list = await fs.readdir(`pages/photo`)
            const roll_list_sorted = roll_list.sort().reverse()
            if (`${frontmatter.title}.md` === roll_list_sorted[0]) {
                latest_roll = true;
            }
        }
        else {
            document.title = frontmatter.title
            markdown = `<h2>${frontmatter.title}</h2>\n\n` + markdown
        }
    }
    markdown = markdown.replace("[READ MORE]", `<a class="readmore" href="/">Read more</a>`)

    // Convert .md markdown into HTML
    const parsedHtml = marked.parse(markdown)

    if (targetPath === 'photo') {
        const tempDom = new JSDOM(parsedHtml);
        const tempDocument = tempDom.window.document;
        const firstImg = tempDocument.querySelector('img');

        let firstImagePath = null;

        if (firstImg) {
            firstImagePath = firstImg.getAttribute('src');
            const preloadLink = document.createElement('link');
            preloadLink.rel = 'preload';
            preloadLink.href = firstImagePath;
            // preloadLink.as = 'image';
            preloadLink.setAttribute("as", "image");

            document.head.appendChild(preloadLink);
            // console.log("TESTING")
            // console.log('Preload link attributes:', preloadLink.outerHTML);
        }

    }
    
    // Add .md HTML to the "page-content" div in the document
    const pageContentElement = document.getElementById('page-content')
    if (pageContentElement) {
        pageContentElement.innerHTML = parsedHtml
    } else {
        console.log(
            `Could not find element with id 'page-content' in template ${templatePath}. Generating page without markdown content.`
        )
    }

    // Convert YYYYMMDD number into "Month Day, Year" string
    if (frontmatter.date) {
        const calendar = ["January","February","March","April","May","June","July","August","September","October","November","December"]
        let month = calendar[parseInt(frontmatter.date.toString().slice(4,6)) - 1]
        const day = frontmatter.date.toString().slice(6).replace(/^0/, "")
        const year = frontmatter.date.toString().slice(0,4)

        // Add span element with date string under page heading
        let dateSpan = document.createElement("span")
        dateSpan.setAttribute("class", "muted date")
        dateSpan.innerHTML = month + " " + day + ", " + year
        let dateInsert = document.getElementsByTagName("h2")
        dateInsert[0].parentNode.insertBefore(dateSpan, dateInsert[0].nextSibling)
    }

    // Check for "html" tag, throw error if not present
    const wrapperHtmlElement = document.getElementsByTagName('html')
    if (!wrapperHtmlElement.length) {
        console.log(`Templates should contain the 'html' tag.`)
        process.exit(1)
    }

    if (targetPath === "text") {
        blogPages.push([frontmatter, document, pageName])
        return
    }

    // if this is latest img post, duplicate it as img.md in main nav

    const finalHtml = "<!DOCTYPE "+document.doctype.name+">\n"+document.getElementsByTagName('html')[0].outerHTML

    await fs.writeFile(`public/${targetPath}/${pageName}.html`, finalHtml)
    
    if (latest_roll == true) {
        await fs.writeFile(`public/photo.html`, finalHtml)
    }
}

async function blogIndex() {

    // Sort blog pages by most recent Date field
    blogPages.sort(function(a, b){return b[0].date - a[0].date})

    // Read raw text of .md file
    const fileData = await fs.readFile("pages/.blogIndex.md", 'utf-8')
    // Parse raw text into frontmatter and markdown
    const { attributes: frontmatter, body: markdown } = await fm(fileData)

    let originalBlogPages = Array.from(blogPages)
    let totalBlogPages = blogPages.length
    let totalIndexPages = Math.ceil(blogPages.length/postsPerPage)
    let pageCount = 1
    let pageIndex = 0
    while (blogPages.length !== 0) {

        const dom = await JSDOM.fromFile('templates/blogIndex.html')
        const document = dom.window.document
        
        const componentHead = await fs.readFile('templates/component_head.html', 'utf-8')
        const headElement = document.getElementsByTagName('head')
        headElement[0].innerHTML = componentHead

        // Add description to meta element
        if (frontmatter.description) {
            let description = headElement[0].getElementsByTagName("meta").description
            description.content = frontmatter.description        
        }
     
        document.title = frontmatter.title

        var aggregatePages = ""
        var blogPagesSplice = blogPages.splice(0, postsPerPage)
        for (const page of blogPagesSplice) {
            // Create copy of blog page document to be used for index page
            let documentCopy = page[1].cloneNode(true)
            // Insert link into H2
            let h2 = documentCopy.getElementsByTagName("h2")[0].innerHTML
            documentCopy.getElementsByTagName("h2")[0].innerHTML = `<a href="/text/${page[2]}">${h2}</a>`
            if (documentCopy.getElementsByClassName("cover-image")[0]) {
                let coverImage = documentCopy.getElementsByClassName("cover-image")[0]
                coverImage.outerHTML = `<a href="/text/${page[2]}">${coverImage.outerHTML}</a>`
            }
            documentCopy.getElementsByClassName("readmore")[0].setAttribute("href", `/text/${page[2]}`)
            const readMoreParent = documentCopy.getElementsByClassName("readmore")[0].parentNode
            // Remove all elements below Read More button
            while (readMoreParent.nextElementSibling !== null) {
                readMoreParent.nextElementSibling.remove()
            }
            // Add the HTML to index page
            aggregatePages += documentCopy.getElementById('page-content').innerHTML
            
            // BUILD INDIVIDUAL BLOG POST
            // Remove Read More button
            page[1].getElementsByClassName("readmore")[0].parentNode.remove()
            
            // Add Prev/Next buttons
            let prevNextContainer = document.createElement("div")
            prevNextContainer.setAttribute("id", "prev-next-container")
            page[1].getElementById("page-content").insertAdjacentElement('beforeend', prevNextContainer)
            if (pageIndex !== 0) {
                let newerButton = document.createElement("span")
                newerButton.innerHTML = `<a href="/text/${originalBlogPages[pageIndex - 1][2]}" class="readmore">Newer</a>`
                page[1].getElementById("prev-next-container").insertAdjacentElement('beforeend', newerButton)
            }
            if (pageIndex !== totalBlogPages - 1) {
                let olderButton = document.createElement("span")
                olderButton.setAttribute("class", "older-button")
                olderButton.innerHTML = `<a href="/text/${originalBlogPages[pageIndex + 1][2]}" class="readmore">Older</a>`
                page[1].getElementById("prev-next-container").insertAdjacentElement('beforeend', olderButton)
            }

            page[1].getElementById("page-content").innerHTML = "<div id='post-section'>" + page[1].getElementById("page-content").innerHTML + "</div><div id='comments-section'></div>"

            // Add comments
            if (fs.existsSync(`static/comments/${page[2]}/`)) {
                let componentComment = await fs.readFile('templates/component_comment.html', 'utf-8')
                let commentsList = await fs.readdir(`static/comments/${page[2]}/`)
                let commentListDiv = document.createElement("div")
                commentListDiv.setAttribute("id", "comment-list")
                commentListDiv.innerHTML = "<h2>Comments</h2>"
                commentsList.forEach(ymlFile => {
                    // Read YML file
                    const ymlData = fs.readFileSync(`static/comments/${page[2]}/${ymlFile}`, 'utf-8')
                    // Parse YML file
                    ymlParsed = yaml.parse(ymlData)
                    // Insert comment data into template
                    let commentArticle = document.createElement("article")
                    commentArticle.setAttribute("id", `comment-${ymlParsed._id}`)
                    commentArticle.setAttribute("class", "comment-article")
                    commentArticle.setAttribute("uid", ymlParsed._id)
                    commentArticle.innerHTML = componentComment
                    commentArticle.getElementsByClassName("comment-author")[0].innerHTML = ymlParsed.name + commentArticle.getElementsByClassName("comment-author")[0].innerHTML
                    commentArticle.getElementsByClassName("comment-link")[0].setAttribute("href", `#comment-${ymlParsed._id}`)
                    let date = new Date(ymlParsed.date).toLocaleString('default', {year: 'numeric', month: 'long', day: 'numeric',})
                    let time = new Date(ymlParsed.date).toLocaleTimeString('default', {timeStyle: "short"})
                    commentArticle.getElementsByClassName("comment-link")[0].innerHTML = ` - ${date} at ${time}`
                    
                    commentArticle.getElementsByClassName("comment-text")[0].innerHTML = marked.parse(ymlParsed.message, {breaks: true})
                    
                    if (!ymlParsed.replying_to_uid) {
                        commentArticle.getElementsByClassName("comment-reply-link")[0].innerHTML = `[ Reply to ${ymlParsed.name} ]`
                        commentArticle.getElementsByClassName("comment-reply-link")[0].setAttribute("onclick", 
                        `return addComment.moveForm('comment-${ymlParsed._id}', 'comment-form', '${ymlParsed._id}', '${ymlParsed.name}')`)
                        commentListDiv.insertAdjacentElement('beforeend', commentArticle)   
                    } else {
                        commentArticle.getElementsByClassName("comment-reply-link")[0].remove()
                        commentArticle.classList.add("nested")
                        commentListDiv.querySelector(`#comment-${ymlParsed.replying_to_uid}`).after(commentArticle)
                    }
                    
                    // Insert comment element in DOM
                })
                page[1].getElementById("comments-section").insertAdjacentElement('beforeend', commentListDiv)
            }

            // Add comment form
            let componentCommentForm = await fs.readFile('templates/component_comment_form.html', 'utf-8')
            componentCommentForm = componentCommentForm.replace("{{ absolute_url }}", `https://jasonhallen.com/blog/${page[2]}.html`)
            componentCommentForm = componentCommentForm.replace("{{ slug }}", page[2])
            let commentFormDiv = document.createElement("div")
            commentFormDiv.setAttribute("id", "comment-form")
            commentFormDiv.innerHTML = componentCommentForm
            // page[1].getElementById("page-content").insertAdjacentElement('beforeend', commentFormDiv)
            page[1].getElementById("comments-section").appendChild(commentFormDiv)

            // Save individual blog post as HTML file
            const finalHtml = "<!DOCTYPE "+page[1].doctype.name+">\n"+page[1].getElementsByTagName('html')[0].outerHTML
            await fs.writeFile(`public/text/${page[2]}.html`, finalHtml)

            pageIndex += 1
        }
        const pageContentElement = document.getElementById('page-content')
        pageContentElement.innerHTML = aggregatePages
        
        // Add pagination
        if (pageCount === 1) {
            document.getElementById("paginationBegin").setAttribute("class", "muted")
            document.getElementById("paginationBack").setAttribute("class", "muted")
            if (pageCount !== totalIndexPages) {
                document.getElementById("paginationForward").innerHTML = `<a href="/text/${pageCount + 1}">></a>`
                document.getElementById("paginationEnd").innerHTML = `<a href="/text/${totalIndexPages}">>></a>`
            }
        }
        if (pageCount === totalIndexPages) {
            document.getElementById("paginationForward").setAttribute("class", "muted")
            document.getElementById("paginationEnd").setAttribute("class", "muted")
            if (pageCount !== 1) {
                document.getElementById("paginationBegin").innerHTML = `<a href="/text"><<</a>`
                if (pageCount === 2) {
                    document.getElementById("paginationBack").innerHTML = `<a href="/text"><</a>`
                } else {
                    document.getElementById("paginationBack").innerHTML = `<a href="/text/${pageCount - 1}"><</a>`
                }
            }
        }
        if (pageCount !== 1 && pageCount !== totalIndexPages) {
            document.getElementById("paginationBegin").innerHTML = `<a href="/text"><<</a>`
            if (pageCount === 2) {
                document.getElementById("paginationBack").innerHTML = `<a href="/text"><</a>`
            } else {
                document.getElementById("paginationBack").innerHTML = `<a href="/text/${pageCount - 1}"><</a>`
            }
            document.getElementById("paginationForward").innerHTML = `<a href="/text/${pageCount + 1}">></a>`
            document.getElementById("paginationEnd").innerHTML = `<a href="/text/${totalIndexPages}">>></a>`
        }
        document.getElementById("paginationPages").innerHTML = `${pageCount} of ${totalIndexPages}`


        const finalHtml = "<!DOCTYPE html>\n"+document.getElementsByTagName('html')[0].outerHTML
        if (pageCount === 1) {
            // await fs.writeFile('public/index.html', finalHtml)
            await fs.writeFile('public/text.html', finalHtml)
        } else {
            await fs.writeFile(`public/text/${pageCount}.html`, finalHtml)
        }
        pageCount += 1
    }
}

async function rollPage(current_roll) {
    // Get list of roll MD files in img directory
    let roll_list = await fs.readdir(`pages/photo`)
    const roll_list_sorted = roll_list.sort().reverse()
    let select_custom_string = '<div id="select-custom">\n'
    select_custom_string += `<div id="select-selected"><h2 onclick="selectOpen(event)">Roll: ${current_roll}</h2></div>\n`
    select_custom_string += '<div class="select-items select-hide" onmouseover="mouseoverDropdown(event)">\n'
    roll_list_sorted.forEach(roll => {
        let roll_id = roll.slice(0, -3)
        if (current_roll === roll_id) {
            select_custom_string += `<div class="current-selection pseudo-hover"><a href="/photo/${roll_id}">${roll_id}</a></div>\n`
        } else {
            select_custom_string += `<div><a href="/photo/${roll_id}">${roll_id}</a></div>\n`
        }
    })
    select_custom_string += '</div>\n</div>\n'
    // console.log(select_custom_string)
    return select_custom_string

    // Sort by reverse numerical order
    // Create div container - select-custom
    // For each item in list add as option
    // When item matches current page, insert current selection class
    // Create h2 with dropdown menu
    // Insert film and camera metadata
    // Embed images
}

async function develop(port) {
    await build()
    const server = startServer(port)
    const watcher = chokidar.watch(['pages/', 'static/', 'templates/']).on('change', async (path, _) => {
        console.log(`Detected change in file ${path}. Restarting development server.`)
        server.close()
        await watcher.close()
        await develop(port)
    })
}

function startServer(port) {
    console.log(`Development server starting on http://localhost:${port}`)
    return http
        .createServer(function (req, res) {
            const url = req.url
            let filePath = url
            if (url === '/') {
                filePath = '/index.html'
            } else if (!url.includes('.')) {
                filePath += '.html'
            }
            fs.readFile('public' + filePath, function (err, data) {
                if (err) {
                    res.writeHead(404)
                    res.end('<h1>404: Page not found</h1>')
                    return
                }
                res.writeHead(200)
                res.end(data)
            })
        })
        .listen(port)
}

function formatDate() {

}

async function safeExecute(func) {
    try {
        await func()
    } catch {}
}
